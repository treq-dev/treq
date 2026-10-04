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

/// The sign-in begun but not yet awaited: `Err` when it was cancelled before
/// `complete_local_oauth` picked it up.
pub(crate) static PENDING: tokio::sync::Mutex<Option<Result<PendingOAuth, String>>> =
  tokio::sync::Mutex::const_new(None);

/// Ends the `complete_local_oauth` that is waiting, with the reason sent.
/// The `u64` tells one waiter's registration from a later one's.
static ACTIVE: std::sync::Mutex<Option<(u64, tokio::sync::oneshot::Sender<String>)>> =
  std::sync::Mutex::new(None);
static NEXT_ACTIVE_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

pub(crate) fn active_slot(
) -> std::sync::MutexGuard<'static, Option<(u64, tokio::sync::oneshot::Sender<String>)>> {
  ACTIVE
    .lock()
    .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Clears `ACTIVE` when `complete_local_oauth` returns, unless a later
/// sign-in has registered since.
struct ActiveGuard(u64);

impl Drop for ActiveGuard {
  fn drop(&mut self) {
    let mut slot = active_slot();
    if slot.as_ref().is_some_and(|(id, _)| *id == self.0) {
      *slot = None;
    }
  }
}

const CANCELLED: &str = "Google sign-in was cancelled";

fn end_active(reason: &str) {
  let sender = active_slot().take();
  if let Some((_, sender)) = sender {
    let _ = sender.send(reason.to_string());
  }
}

/// Cancels a sign-in that is pending or waiting for the browser; the waiting
/// `complete_local_oauth` returns "Google sign-in was cancelled".
pub async fn cancel_local_oauth() {
  let mut pending = PENDING.lock().await;
  if matches!(*pending, Some(Ok(_))) {
    *pending = Some(Err(CANCELLED.to_string()));
  }
  drop(pending);
  end_active(CANCELLED);
}

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
  let mut slot = PENDING.lock().await;
  end_active("Google sign-in was restarted");
  *slot = Some(Ok(PendingOAuth {
    listener,
    redirect_uri,
    state,
    verifier,
    client_id,
    client_secret: non_empty(client_secret),
  }));
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

/// Answers one connection, and forwards the outcome when it is Google's
/// redirect for this sign-in.
async fn handle_connection(
  mut stream: tokio::net::TcpStream,
  state: &str,
  outcome: tokio::sync::mpsc::Sender<Result<String, String>>,
) {
  let Some(line) = read_request_line(&mut stream).await else {
    return;
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
      let _ = outcome.try_send(Err(format!("Google sign-in failed: {error}")));
    }
    Redirect::Code(code) => {
      respond(
        &mut stream,
        "200 OK",
        "Google Workspace is connected. You can close this tab and return to treq.",
      )
      .await;
      let _ = outcome.try_send(Ok(code));
    }
  }
}

/// Accepts connections until Google's redirect for this sign-in arrives.
/// Each connection is read in its own task, so idle ones cannot hold up the
/// redirect; they are dropped when this returns.
pub(crate) async fn wait_for_code(
  listener: &tokio::net::TcpListener,
  state: &str,
) -> Result<String, String> {
  let (tx, mut rx) = tokio::sync::mpsc::channel(1);
  let mut connections = tokio::task::JoinSet::new();
  loop {
    tokio::select! {
      Some(outcome) = rx.recv() => return outcome,
      Some(_) = connections.join_next() => {}
      accepted = listener.accept() => {
        let (stream, _) = accepted.map_err(|e| e.to_string())?;
        let (tx, state) = (tx.clone(), state.to_string());
        connections.spawn(async move { handle_connection(stream, &state, tx).await });
      }
    }
  }
}

/// Waits (up to five minutes) for the browser redirect, exchanges the code
/// and returns the tokens to store.
pub async fn complete_local_oauth() -> Result<(StoredTokens, String, Option<String>), String> {
  let (ended_tx, mut ended) = tokio::sync::oneshot::channel::<String>();
  let active_id = NEXT_ACTIVE_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
  let _active = ActiveGuard(active_id);
  let pending = {
    let mut slot = PENDING.lock().await;
    let pending = slot.take().ok_or("No Google sign-in in progress")??;
    // Registered under the PENDING lock so a later begin or cancel sees it.
    end_active("Google sign-in was restarted");
    *active_slot() = Some((active_id, ended_tx));
    pending
  };
  let code = tokio::select! {
    result = tokio::time::timeout(SIGN_IN_TIMEOUT, wait_for_code(&pending.listener, &pending.state)) => {
      result.map_err(|_| "Timed out waiting for Google sign-in".to_string())??
    }
    reason = &mut ended => return Err(reason.unwrap_or_else(|_| CANCELLED.to_string())),
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
  // A cancel or restart during the exchange must win: its caller has moved on.
  let grant = tokio::select! {
    grant = token_request(&form) => grant?,
    reason = &mut ended => return Err(reason.unwrap_or_else(|_| CANCELLED.to_string())),
  };
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
  token_request_coded(form)
    .await
    .map_err(|(message, _)| message)
}

/// Like `token_request`, but a failure also carries Google's `error` code.
async fn token_request_coded(form: &[(&str, String)]) -> Result<Value, (String, Option<String>)> {
  let response = http_client()
    .post(token_url())
    .timeout(REQUEST_TIMEOUT)
    .form(form)
    .send()
    .await
    .map_err(|e| (format!("Failed to reach Google: {e}"), None))?;
  let status = response.status();
  let body: Value = response.json().await.unwrap_or(Value::Null);
  if !status.is_success() {
    let reason = body
      .get("error_description")
      .or_else(|| body.get("error"))
      .and_then(Value::as_str)
      .unwrap_or("unknown error");
    return Err((
      format!("Google token request failed ({status}): {reason}"),
      str_field(&body, "error"),
    ));
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
    lifetime_secs: grant.get("expires_in").and_then(Value::as_i64),
  })
}

pub(crate) const REVOKED: &str =
  "Google authorization expired or was revoked. Reconnect Google Workspace in Settings.";
/// How long a failed refresh is reused, so requests queued behind it fail
/// the same way instead of each asking Google again.
const FAILURE_TTL: Duration = Duration::from_secs(10);

#[derive(Default)]
struct RefreshState {
  refreshed: Option<StoredTokens>,
  failure: Option<(String, std::time::Instant)>,
}

/// One lock per refresh token: a refresh of one grant never waits on another.
static REFRESHES: std::sync::Mutex<
  Option<std::collections::HashMap<String, std::sync::Arc<tokio::sync::Mutex<RefreshState>>>>,
> = std::sync::Mutex::new(None);

fn refresh_slot(refresh: &str) -> std::sync::Arc<tokio::sync::Mutex<RefreshState>> {
  let mut map = match REFRESHES.lock() {
    Ok(guard) => guard,
    Err(poisoned) => poisoned.into_inner(),
  };
  map
    .get_or_insert_with(Default::default)
    .entry(refresh.to_string())
    .or_default()
    .clone()
}

/// Returns a usable access token for a local source, refreshing it when it
/// is about to expire. The refreshed tokens are written back to the app db.
/// Concurrent refreshes of one grant are single-flight: the first asks
/// Google, the rest reuse its tokens (or its error, for `FAILURE_TTL`).
pub(crate) async fn local_access_token(
  tokens: &StoredTokens,
  client_id: &str,
  client_secret: &Option<String>,
  token_db: &Option<PathBuf>,
) -> Result<String, String> {
  if is_fresh(tokens) {
    return Ok(tokens.access_token.clone());
  }
  let refresh = tokens
    .refresh_token
    .clone()
    .ok_or("Google authorization expired. Reconnect Google Workspace in Settings.")?;
  let slot = refresh_slot(&refresh);
  let mut state = slot.lock().await;
  if let Some(cached) = state.refreshed.as_ref().filter(|c| is_fresh(c)) {
    return Ok(cached.access_token.clone());
  }
  if let Some((error, _)) = state
    .failure
    .as_ref()
    .filter(|(_, at)| at.elapsed() < FAILURE_TTL)
  {
    return Err(error.clone());
  }
  let mut form = vec![
    ("client_id", client_id.to_string()),
    ("grant_type", "refresh_token".to_string()),
    ("refresh_token", refresh.clone()),
  ];
  if let Some(secret) = client_secret {
    form.push(("client_secret", secret.clone()));
  }
  let grant = match token_request_coded(&form).await {
    Ok(grant) => grant,
    Err((message, code)) => {
      let message = if code.as_deref() == Some("invalid_grant") {
        if let Some(path) = token_db {
          clear_tokens(path, &refresh);
        }
        REVOKED.to_string()
      } else {
        message
      };
      state.failure = Some((message.clone(), std::time::Instant::now()));
      return Err(message);
    }
  };
  let refreshed = tokens_from_grant(&grant, Some(refresh))?;
  if let Some(path) = token_db {
    save_tokens(path, &refreshed);
  }
  let access_token = refreshed.access_token.clone();
  state.refreshed = Some(refreshed);
  state.failure = None;
  Ok(access_token)
}

/// Refresh margin: a minute, or half the token's lifetime if shorter, so a
/// short-lived token is not refreshed on every request.
pub(crate) fn refresh_margin(tokens: &StoredTokens) -> i64 {
  tokens.lifetime_secs.map_or(REFRESH_MARGIN_SECS, |life| {
    REFRESH_MARGIN_SECS.min(life / 2)
  })
}

pub(crate) fn is_fresh(tokens: &StoredTokens) -> bool {
  tokens
    .expires_at
    .is_none_or(|at| at - now_secs() > refresh_margin(tokens))
}

/// Deletes the stored tokens after Google revoked them, unless they were
/// already replaced by a newer grant.
pub(crate) fn clear_tokens(path: &std::path::Path, revoked_refresh: &str) {
  let Ok(db) = Database::new(path.to_path_buf()) else {
    return;
  };
  let stored = read_local_tokens(&db);
  if stored.is_some_and(|t| t.refresh_token.as_deref() == Some(revoked_refresh)) {
    if let Err(e) = disconnect_local(&db) {
      tracing::warn!("Failed to clear revoked Google tokens: {e}");
    }
  }
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
