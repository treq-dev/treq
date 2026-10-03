//! Loopback OAuth with PKCE, for users with their own Google OAuth client.

use super::*;

pub(crate) fn now_secs() -> i64 {
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_secs() as i64)
    .unwrap_or(0)
}

pub(crate) fn base64url(bytes: &[u8]) -> String {
  const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
  for chunk in bytes.chunks(3) {
    let n = chunk.iter().fold(0u32, |acc, b| (acc << 8) | *b as u32) << (8 * (3 - chunk.len()));
    for i in 0..=chunk.len() {
      out.push(ALPHABET[((n >> (18 - 6 * i)) & 63) as usize] as char);
    }
  }
  out
}

pub(crate) fn random_token() -> Result<String, String> {
  let mut bytes = [0u8; 32];
  getrandom::fill(&mut bytes).map_err(|e| format!("Failed to generate random bytes: {e}"))?;
  Ok(base64url(&bytes))
}

pub fn pkce_challenge(verifier: &str) -> String {
  use sha2::Digest;
  base64url(&sha2::Sha256::digest(verifier.as_bytes()))
}

pub fn authorize_url(client_id: &str, redirect_uri: &str, state: &str, challenge: &str) -> String {
  let mut url = url::Url::parse(AUTH_URL).expect("static URL");
  url
    .query_pairs_mut()
    .append_pair("client_id", client_id)
    .append_pair("redirect_uri", redirect_uri)
    .append_pair("response_type", "code")
    .append_pair("scope", SCOPES)
    .append_pair("state", state)
    .append_pair("code_challenge", challenge)
    .append_pair("code_challenge_method", "S256")
    .append_pair("access_type", "offline")
    .append_pair("prompt", "consent");
  url.to_string()
}

pub(crate) struct PendingOAuth {
  listener: tokio::net::TcpListener,
  redirect_uri: String,
  state: String,
  verifier: String,
  client_id: String,
  client_secret: Option<String>,
}

pub(crate) static PENDING: tokio::sync::Mutex<Option<PendingOAuth>> =
  tokio::sync::Mutex::const_new(None);

// Wakes a `complete_local_oauth` that a newer `begin_local_oauth` replaced,
// so the abandoned flow ends at once instead of holding its port.
static SUPERSEDED: tokio::sync::Notify = tokio::sync::Notify::const_new();

/// A local process could connect and send nothing; it gets this long before
/// the listener moves on to the next connection.
const CONNECTION_READ_TIMEOUT: Duration = if cfg!(test) {
  Duration::from_millis(200)
} else {
  Duration::from_secs(5)
};
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(300);

/// Binds a loopback port and returns the URL to open in the browser.
/// `complete_local_oauth` then waits for Google to redirect back. Starting
/// again cancels a sign-in that is still waiting.
pub async fn begin_local_oauth(
  client_id: String,
  client_secret: Option<String>,
) -> Result<String, String> {
  let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
    .await
    .map_err(|e| format!("Failed to open a local port for Google sign-in: {e}"))?;
  let port = listener.local_addr().map_err(|e| e.to_string())?.port();
  let redirect_uri = format!("http://127.0.0.1:{port}");
  let state = random_token()?;
  let verifier = random_token()?;
  let url = authorize_url(
    &client_id,
    &redirect_uri,
    &state,
    &pkce_challenge(&verifier),
  );
  SUPERSEDED.notify_waiters();
  *PENDING.lock().await = Some(PendingOAuth {
    listener,
    redirect_uri,
    state,
    verifier,
    client_id,
    client_secret: non_empty(client_secret),
  });
  Ok(url)
}

/// What one request to the loopback listener means for the sign-in.
#[derive(Debug, PartialEq)]
pub enum Redirect {
  /// Google redirected back with a code for this sign-in.
  Code(String),
  /// Google redirected back for this sign-in with an error, e.g. the user
  /// denied access.
  Denied(String),
  /// Not Google's redirect for this sign-in: a favicon request, another path,
  /// or a missing or wrong `state`. The listener keeps waiting, so a local
  /// process that finds the port cannot end the sign-in.
  Ignore,
}

/// Classifies a request line such as `GET /?state=…&code=… HTTP/1.1`.
pub fn parse_redirect(request_line: &str, expected_state: &str) -> Redirect {
  let mut parts = request_line.split_whitespace();
  let (Some("GET"), Some(target)) = (parts.next(), parts.next()) else {
    return Redirect::Ignore;
  };
  let Ok(url) = url::Url::parse(&format!("http://127.0.0.1{target}")) else {
    return Redirect::Ignore;
  };
  if url.path() != "/" {
    return Redirect::Ignore;
  }
  let param = |name: &str| {
    url
      .query_pairs()
      .find(|(k, _)| k == name)
      .map(|(_, v)| v.into_owned())
  };
  if param("state").as_deref() != Some(expected_state) {
    return Redirect::Ignore;
  }
  match (param("code"), param("error")) {
    (_, Some(error)) => Redirect::Denied(error),
    (Some(code), None) => Redirect::Code(code),
    (None, None) => Redirect::Denied("no authorization code".to_string()),
  }
}

/// Reads up to the end of the request line, giving up after
/// `CONNECTION_READ_TIMEOUT` or 8 KiB.
async fn read_request_line(stream: &mut tokio::net::TcpStream) -> Option<String> {
  use tokio::io::AsyncReadExt;
  let mut buf = Vec::with_capacity(1024);
  let read = async {
    let mut chunk = [0u8; 1024];
    while !buf.windows(2).any(|w| w == b"\r\n") && buf.len() < 8192 {
      let n = stream.read(&mut chunk).await.ok()?;
      if n == 0 {
        break;
      }
      buf.extend_from_slice(&chunk[..n]);
    }
    Some(())
  };
  tokio::time::timeout(CONNECTION_READ_TIMEOUT, read)
    .await
    .ok()??;
  let text = String::from_utf8_lossy(&buf);
  text.lines().next().map(str::to_string)
}

async fn respond(stream: &mut tokio::net::TcpStream, status: &str, body: &str) {
  use tokio::io::AsyncWriteExt;
  let response = format!(
    "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
    body.len()
  );
  let _ = stream.write_all(response.as_bytes()).await;
}

/// Accepts connections until Google's redirect for this sign-in arrives.
pub(crate) async fn wait_for_code(
  listener: &tokio::net::TcpListener,
  state: &str,
) -> Result<String, String> {
  loop {
    let (mut stream, _) = listener.accept().await.map_err(|e| e.to_string())?;
    let Some(line) = read_request_line(&mut stream).await else {
      continue;
    };
    match parse_redirect(&line, state) {
      Redirect::Ignore => respond(&mut stream, "404 Not Found", "").await,
      Redirect::Denied(error) => {
        respond(
          &mut stream,
          "200 OK",
          "Google sign-in failed. Return to treq and try again.",
        )
        .await;
        return Err(format!("Google sign-in failed: {error}"));
      }
      Redirect::Code(code) => {
        respond(
          &mut stream,
          "200 OK",
          "Google Workspace is connected. You can close this tab and return to treq.",
        )
        .await;
        return Ok(code);
      }
    }
  }
}

/// Waits (up to five minutes) for the browser redirect, exchanges the code
/// and returns the tokens to store.
pub async fn complete_local_oauth() -> Result<(StoredTokens, String, Option<String>), String> {
  let superseded = SUPERSEDED.notified();
  let pending = PENDING
    .lock()
    .await
    .take()
    .ok_or("No Google sign-in in progress")?;
  let code = tokio::select! {
    result = tokio::time::timeout(SIGN_IN_TIMEOUT, wait_for_code(&pending.listener, &pending.state)) => {
      result.map_err(|_| "Timed out waiting for Google sign-in".to_string())??
    }
    _ = superseded => return Err("Google sign-in was restarted".to_string()),
  };

  let mut form = vec![
    ("client_id", pending.client_id.clone()),
    ("code", code),
    ("code_verifier", pending.verifier.clone()),
    ("grant_type", "authorization_code".to_string()),
    ("redirect_uri", pending.redirect_uri.clone()),
  ];
  if let Some(secret) = &pending.client_secret {
    form.push(("client_secret", secret.clone()));
  }
  let grant = token_request(&form).await?;
  let tokens = tokens_from_grant(&grant, None)?;
  Ok((tokens, pending.client_id, pending.client_secret))
}

/// Stores the client and its first tokens after a successful sign-in.
pub fn store_local_grant(
  db: &Database,
  tokens: &StoredTokens,
  client_id: &str,
  client_secret: Option<&str>,
) -> Result<(), String> {
  let raw = serde_json::to_string(tokens).map_err(|e| e.to_string())?;
  db.set_setting(CLIENT_ID_SETTING, client_id)
    .and_then(|_| db.set_setting(CLIENT_SECRET_SETTING, client_secret.unwrap_or("")))
    .and_then(|_| db.set_setting(TOKENS_SETTING, &raw))
    .map_err(|e| format!("Failed to store Google tokens: {e}"))
}

pub(crate) async fn token_request(form: &[(&str, String)]) -> Result<Value, String> {
  let response = http_client()
    .post(token_url())
    .timeout(REQUEST_TIMEOUT)
    .form(form)
    .send()
    .await
    .map_err(|e| format!("Failed to reach Google: {e}"))?;
  let status = response.status();
  let body: Value = response.json().await.unwrap_or(Value::Null);
  if !status.is_success() {
    let reason = body
      .get("error_description")
      .or_else(|| body.get("error"))
      .and_then(Value::as_str)
      .unwrap_or("unknown error");
    return Err(format!("Google token request failed ({status}): {reason}"));
  }
  Ok(body)
}

pub fn tokens_from_grant(
  grant: &Value,
  previous_refresh: Option<String>,
) -> Result<StoredTokens, String> {
  let access_token = grant
    .get("access_token")
    .and_then(Value::as_str)
    .ok_or("Google returned no access token")?
    .to_string();
  Ok(StoredTokens {
    access_token,
    // Refresh grants usually omit the refresh token; keep the old one.
    refresh_token: grant
      .get("refresh_token")
      .and_then(Value::as_str)
      .map(str::to_string)
      .or(previous_refresh),
    expires_at: grant
      .get("expires_in")
      .and_then(Value::as_i64)
      .map(|secs| now_secs() + secs),
  })
}

/// Returns a usable access token for a local source, refreshing it when it
/// is about to expire. The refreshed tokens are written back to the app db.
pub(crate) async fn local_access_token(
  tokens: &StoredTokens,
  client_id: &str,
  client_secret: &Option<String>,
  token_db: &Option<PathBuf>,
) -> Result<String, String> {
  if is_fresh(tokens) {
    return Ok(tokens.access_token.clone());
  }
  // Single flight: requests that find the token expiring wait here, and all
  // but the first reuse its result instead of refreshing (and writing) again.
  let mut latest = REFRESHED.lock().await;
  if let Some(cached) = latest
    .as_ref()
    .filter(|c| c.refresh_token == tokens.refresh_token && is_fresh(c))
  {
    return Ok(cached.access_token.clone());
  }
  let refresh = tokens
    .refresh_token
    .clone()
    .ok_or("Google authorization expired. Reconnect Google Workspace in Settings.")?;
  let mut form = vec![
    ("client_id", client_id.to_string()),
    ("grant_type", "refresh_token".to_string()),
    ("refresh_token", refresh.clone()),
  ];
  if let Some(secret) = client_secret {
    form.push(("client_secret", secret.clone()));
  }
  let grant = token_request(&form).await?;
  let refreshed = tokens_from_grant(&grant, Some(refresh))?;
  if let Some(path) = token_db {
    save_tokens(path, &refreshed);
  }
  let access_token = refreshed.access_token.clone();
  *latest = Some(refreshed);
  Ok(access_token)
}

/// The last refreshed tokens, shared by concurrent requests.
static REFRESHED: tokio::sync::Mutex<Option<StoredTokens>> = tokio::sync::Mutex::const_new(None);

fn is_fresh(tokens: &StoredTokens) -> bool {
  tokens
    .expires_at
    .is_none_or(|at| at - now_secs() > REFRESH_MARGIN_SECS)
}

pub(crate) fn save_tokens(path: &std::path::Path, tokens: &StoredTokens) {
  if let (Ok(db), Ok(raw)) = (
    Database::new(path.to_path_buf()),
    serde_json::to_string(tokens),
  ) {
    if let Err(e) = db.set_setting(TOKENS_SETTING, &raw) {
      tracing::warn!("Failed to store refreshed Google tokens: {e}");
    }
  }
}
