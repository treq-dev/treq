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

/// Binds a loopback port and returns the URL to open in the browser.
/// `complete_local_oauth` then waits for Google to redirect back.
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

/// Pulls `code` out of the redirect's request line after checking `state`.
pub fn parse_redirect(request_line: &str, expected_state: &str) -> Result<String, String> {
  let target = request_line
    .split_whitespace()
    .nth(1)
    .ok_or("Malformed redirect from Google")?;
  let url = url::Url::parse(&format!("http://127.0.0.1{target}"))
    .map_err(|_| "Malformed redirect from Google".to_string())?;
  let param = |name: &str| {
    url
      .query_pairs()
      .find(|(k, _)| k == name)
      .map(|(_, v)| v.into_owned())
  };
  if let Some(error) = param("error") {
    return Err(format!("Google sign-in failed: {error}"));
  }
  if param("state").as_deref() != Some(expected_state) {
    return Err("Google sign-in state did not match. Try connecting again.".to_string());
  }
  param("code").ok_or_else(|| "Google did not return an authorization code".to_string())
}

/// Waits (up to five minutes) for the browser redirect, exchanges the code
/// and returns the tokens to store.
pub async fn complete_local_oauth() -> Result<(StoredTokens, String, Option<String>), String> {
  use tokio::io::{AsyncReadExt, AsyncWriteExt};
  let pending = PENDING
    .lock()
    .await
    .take()
    .ok_or("No Google sign-in in progress")?;
  let accept = tokio::time::timeout(Duration::from_secs(300), async {
    loop {
      let (mut stream, _) = pending.listener.accept().await.map_err(|e| e.to_string())?;
      let mut buf = vec![0u8; 8192];
      let n = stream.read(&mut buf).await.map_err(|e| e.to_string())?;
      let request = String::from_utf8_lossy(&buf[..n]).to_string();
      let first_line = request.lines().next().unwrap_or_default().to_string();
      // Browsers also ask for /favicon.ico; ignore anything without a query.
      if !first_line.contains('?') {
        let _ = stream
          .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n")
          .await;
        continue;
      }
      let result = parse_redirect(&first_line, &pending.state);
      let body = match &result {
        Ok(_) => "Google Workspace is connected. You can close this tab and return to treq.",
        Err(_) => "Google sign-in failed. Return to treq and try again.",
      };
      let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
      );
      let _ = stream.write_all(response.as_bytes()).await;
      return result;
    }
  })
  .await
  .map_err(|_| "Timed out waiting for Google sign-in".to_string())??;

  let mut form = vec![
    ("client_id", pending.client_id.clone()),
    ("code", accept),
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
  let fresh = tokens
    .expires_at
    .is_none_or(|at| at - now_secs() > REFRESH_MARGIN_SECS);
  if fresh {
    return Ok(tokens.access_token.clone());
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
  Ok(refreshed.access_token)
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
