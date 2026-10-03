//! Google Workspace client: Google Tasks and Google Drive (which also covers
//! Google Docs, exported as text for review).
//!
//! Two ways to authenticate, mirroring Linear:
//! - Free: a desktop OAuth client the user registers in Google Cloud. treq
//!   runs the loopback + PKCE flow itself and keeps the tokens in the app
//!   database (`google_oauth_tokens`), refreshing them as they expire.
//! - Pro: the `google-oauth` Edge Functions hold the user's Google grant and
//!   `google-proxy` forwards each request, so no token reaches the device.
//!
//! Local tokens win over the proxy when both exist.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Duration;

use crate::db::Database;

pub const TASKS_API: &str = "https://tasks.googleapis.com/tasks/v1";
pub const DRIVE_API: &str = "https://www.googleapis.com/drive/v3";
const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
/// Tasks for the Kanban; full Drive so any Doc the user picks can be exported
/// and commented on (`drive.file` only sees files treq created).
pub const SCOPES: &str =
  "https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/drive";

pub const CLIENT_ID_SETTING: &str = "google_client_id";
pub const CLIENT_SECRET_SETTING: &str = "google_client_secret";
pub const TOKENS_SETTING: &str = "google_oauth_tokens";

/// Directory, relative to the repo, that exported documents are reviewed in.
pub const REVIEW_DIR: &str = ".treq/google-review";
pub const REVIEW_TARGET_TYPE: &str = "google_doc";
pub const GOOGLE_DOC_MIME: &str = "application/vnd.google-apps.document";

const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
// Refresh a little early so a token cannot expire mid-request.
const REFRESH_MARGIN_SECS: i64 = 60;

// ---------------------------------------------------------------------------
// Auth sources
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StoredTokens {
  pub access_token: String,
  pub refresh_token: Option<String>,
  /// Unix seconds.
  pub expires_at: Option<i64>,
}

pub use crate::proxy_session::ProxySession;

#[derive(Clone)]
pub enum GoogleSource {
  Local {
    tokens: StoredTokens,
    client_id: String,
    client_secret: Option<String>,
    /// App database that refreshed tokens are written back to. `None`
    /// keeps them in memory only (tests).
    token_db: Option<PathBuf>,
  },
  Proxy(ProxySession),
}

static PROXY_SESSION: crate::proxy_session::ProxySessionSlot =
  crate::proxy_session::ProxySessionSlot::new();

/// Sets, or clears on sign-out, the Supabase session sent to `google-proxy`.
pub fn set_proxy_session(supabase_url: Option<String>, access_token: Option<String>) {
  PROXY_SESSION.set(supabase_url, access_token);
}

fn non_empty(value: Option<String>) -> Option<String> {
  value
    .map(|v| v.trim().to_string())
    .filter(|v| !v.is_empty())
}

pub fn read_local_tokens(db: &Database) -> Option<StoredTokens> {
  db.get_setting(TOKENS_SETTING)
    .ok()
    .flatten()
    .and_then(|raw| serde_json::from_str(&raw).ok())
}

/// `token_db` is the path of `db`, where refreshed tokens are written back.
pub fn resolve_source(db: &Database, token_db: PathBuf) -> Result<GoogleSource, String> {
  let client_id = non_empty(db.get_setting(CLIENT_ID_SETTING).ok().flatten());
  let client_secret = non_empty(db.get_setting(CLIENT_SECRET_SETTING).ok().flatten());
  let mut source = choose_source(
    read_local_tokens(db),
    client_id,
    client_secret,
    PROXY_SESSION.get(),
  )?;
  if let GoogleSource::Local { token_db: slot, .. } = &mut source {
    *slot = Some(token_db);
  }
  Ok(source)
}

fn choose_source(
  tokens: Option<StoredTokens>,
  client_id: Option<String>,
  client_secret: Option<String>,
  session: Option<ProxySession>,
) -> Result<GoogleSource, String> {
  match (tokens, client_id, session) {
    (Some(tokens), Some(client_id), _) => Ok(GoogleSource::Local {
      tokens,
      client_id,
      client_secret,
      token_db: None,
    }),
    (_, _, Some(session)) => Ok(GoogleSource::Proxy(session)),
    _ => {
      Err("Google Workspace is not connected. Connect it in Settings > Integrations.".to_string())
    }
  }
}

/// Connection state shown in settings.
#[derive(Debug, Clone, Serialize)]
pub struct GoogleConnectionStatus {
  /// `"local"`, `"proxy"` or `"none"`.
  pub mode: String,
  pub has_client_id: bool,
}

/// Which source requests would use. A signed-in treq session only counts as
/// connected once `google-proxy` confirms it holds a Google grant for it.
pub async fn connection_status(
  source: Result<GoogleSource, String>,
  has_client_id: bool,
) -> GoogleConnectionStatus {
  let mode = match source {
    Ok(GoogleSource::Local { .. }) => "local",
    Ok(GoogleSource::Proxy(session)) if proxy_linked(&session).await => "proxy",
    _ => "none",
  };
  GoogleConnectionStatus {
    mode: mode.to_string(),
    has_client_id,
  }
}

pub fn has_client_id(db: &Database) -> bool {
  non_empty(db.get_setting(CLIENT_ID_SETTING).ok().flatten()).is_some()
}

async fn proxy_linked(session: &ProxySession) -> bool {
  let response = http_client()
    .post(session.function_url("google-proxy"))
    .bearer_auth(&session.access_token)
    .timeout(REQUEST_TIMEOUT)
    .json(&json!({ "op": "status" }))
    .send()
    .await;
  match response {
    Ok(r) if r.status().is_success() => r
      .json::<Value>()
      .await
      .ok()
      .and_then(|v| v.get("linked").and_then(Value::as_bool))
      .unwrap_or(false),
    _ => false,
  }
}

// ---------------------------------------------------------------------------
// Loopback OAuth with PKCE (free tier)
// ---------------------------------------------------------------------------

fn now_secs() -> i64 {
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_secs() as i64)
    .unwrap_or(0)
}

fn base64url(bytes: &[u8]) -> String {
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

fn random_token() -> Result<String, String> {
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

struct PendingOAuth {
  listener: tokio::net::TcpListener,
  redirect_uri: String,
  state: String,
  verifier: String,
  client_id: String,
  client_secret: Option<String>,
}

static PENDING: tokio::sync::Mutex<Option<PendingOAuth>> = tokio::sync::Mutex::const_new(None);

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

async fn token_request(form: &[(&str, String)]) -> Result<Value, String> {
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
async fn local_access_token(
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

fn save_tokens(path: &std::path::Path, tokens: &StoredTokens) {
  if let (Ok(db), Ok(raw)) = (
    Database::new(path.to_path_buf()),
    serde_json::to_string(tokens),
  ) {
    if let Err(e) = db.set_setting(TOKENS_SETTING, &raw) {
      tracing::warn!("Failed to store refreshed Google tokens: {e}");
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

#[cfg(test)]
thread_local! {
  // Rewrites `https://…googleapis.com` and the token URL to a mock server.
  static TEST_BASE: std::cell::RefCell<Option<String>> = const { std::cell::RefCell::new(None) };
}

fn rewrite(url: &str) -> String {
  #[cfg(test)]
  if let Some(base) = TEST_BASE.with(|b| b.borrow().clone()) {
    for prefix in [TASKS_API, DRIVE_API, TOKEN_URL] {
      if let Some(rest) = url.strip_prefix(prefix) {
        let path = url::Url::parse(prefix)
          .expect("static URL")
          .path()
          .to_string();
        return format!("{base}{path}{rest}");
      }
    }
  }
  url.to_string()
}

fn token_url() -> String {
  rewrite(TOKEN_URL)
}

fn http_client() -> &'static reqwest::Client {
  static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
  CLIENT.get_or_init(|| {
    reqwest::Client::builder()
      .connect_timeout(CONNECT_TIMEOUT)
      .build()
      .unwrap_or_else(|_| reqwest::Client::new())
  })
}

/// What a request returns: JSON, or raw text for Drive exports.
enum Body {
  Json(Value),
  Text(String),
}

async fn send(
  source: &GoogleSource,
  method: reqwest::Method,
  url: &str,
  body: Option<&Value>,
) -> Result<Body, String> {
  let request = match source {
    GoogleSource::Local {
      tokens,
      client_id,
      client_secret,
      token_db,
    } => {
      let token = local_access_token(tokens, client_id, client_secret, token_db).await?;
      let mut req = http_client()
        .request(method, rewrite(url))
        .bearer_auth(token);
      if let Some(body) = body {
        req = req.json(body);
      }
      req
    }
    GoogleSource::Proxy(session) => http_client()
      .post(session.function_url("google-proxy"))
      .bearer_auth(&session.access_token)
      .json(&json!({ "method": method.as_str(), "url": url, "body": body })),
  };
  let response = request.timeout(REQUEST_TIMEOUT).send().await.map_err(|e| {
    if e.is_timeout() {
      "Google request timed out".to_string()
    } else {
      format!("Failed to reach Google: {e}")
    }
  })?;
  let status = response.status();
  let is_json = response
    .headers()
    .get(reqwest::header::CONTENT_TYPE)
    .and_then(|v| v.to_str().ok())
    .is_some_and(|v| v.contains("json"));
  let text = response
    .text()
    .await
    .map_err(|e| format!("Failed to read Google response: {e}"))?;
  if !status.is_success() {
    return Err(error_message(
      status,
      &text,
      matches!(source, GoogleSource::Proxy(_)),
    ));
  }
  if text.is_empty() {
    return Ok(Body::Json(Value::Null));
  }
  if is_json {
    serde_json::from_str(&text)
      .map(Body::Json)
      .map_err(|e| format!("Failed to parse Google response: {e}"))
  } else {
    Ok(Body::Text(text))
  }
}

async fn send_json(
  source: &GoogleSource,
  method: reqwest::Method,
  url: &str,
  body: Option<&Value>,
) -> Result<Value, String> {
  match send(source, method, url, body).await? {
    Body::Json(value) => Ok(value),
    Body::Text(_) => Err("Google returned an unexpected response".to_string()),
  }
}

fn error_message(status: reqwest::StatusCode, text: &str, via_proxy: bool) -> String {
  let parsed = serde_json::from_str::<Value>(text).ok();
  // Google: {"error":{"message":…}}; proxy: {"error":"…"}.
  let message = parsed.as_ref().and_then(|v| {
    v.pointer("/error/message")
      .or_else(|| v.get("error"))
      .and_then(Value::as_str)
      .map(str::to_string)
  });
  match (status.as_u16(), message) {
    // The proxy explains a lapsed Google grant itself ("Reconnect Google
    // Workspace…"); only a bare 401 means the treq session was rejected.
    (401, Some(message)) if via_proxy => message,
    (401, None) if via_proxy => {
      "treq could not authenticate with the Google proxy. Sign in to treq again.".to_string()
    }
    (401, _) => {
      "Google rejected the stored token. Reconnect Google Workspace in Settings.".to_string()
    }
    (429, _) => "Google rate limit reached. Try again in a minute.".to_string(),
    (_, Some(message)) => format!("Google: {message}"),
    _ => {
      let body: String = text.chars().take(300).collect();
      format!("Google API error ({status}): {body}")
    }
  }
}

fn enc(segment: &str) -> String {
  url::form_urlencoded::byte_serialize(segment.as_bytes()).collect()
}

// ---------------------------------------------------------------------------
// Google Tasks
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GoogleTaskList {
  pub id: String,
  pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GoogleTask {
  pub id: String,
  pub list_id: String,
  pub title: String,
  pub notes: Option<String>,
  /// `"needsAction"` or `"completed"`.
  pub status: String,
  /// RFC 3339 date; Google only keeps the date part.
  pub due: Option<String>,
  pub parent: Option<String>,
  /// Lexicographic sort key Google assigns within a list.
  pub position: String,
  pub web_link: Option<String>,
}

fn str_field(v: &Value, key: &str) -> Option<String> {
  v.get(key).and_then(Value::as_str).map(str::to_string)
}

pub fn map_task(list_id: &str, v: &Value) -> Option<GoogleTask> {
  Some(GoogleTask {
    id: str_field(v, "id")?,
    list_id: list_id.to_string(),
    title: str_field(v, "title").unwrap_or_default(),
    notes: str_field(v, "notes").filter(|n| !n.is_empty()),
    status: str_field(v, "status").unwrap_or_else(|| "needsAction".to_string()),
    due: str_field(v, "due"),
    parent: str_field(v, "parent"),
    position: str_field(v, "position").unwrap_or_default(),
    web_link: str_field(v, "webViewLink"),
  })
}

pub async fn list_task_lists(source: &GoogleSource) -> Result<Vec<GoogleTaskList>, String> {
  let value = send_json(
    source,
    reqwest::Method::GET,
    &format!("{TASKS_API}/users/@me/lists?maxResults=100"),
    None,
  )
  .await?;
  Ok(
    value
      .get("items")
      .and_then(Value::as_array)
      .into_iter()
      .flatten()
      .filter_map(|v| {
        Some(GoogleTaskList {
          id: str_field(v, "id")?,
          title: str_field(v, "title").unwrap_or_default(),
        })
      })
      .collect(),
  )
}

pub async fn list_tasks(source: &GoogleSource, list_id: &str) -> Result<Vec<GoogleTask>, String> {
  let mut tasks = Vec::new();
  let mut page_token: Option<String> = None;
  loop {
    let mut url = format!(
      "{TASKS_API}/lists/{}/tasks?maxResults=100&showCompleted=true&showHidden=true",
      enc(list_id)
    );
    if let Some(token) = &page_token {
      url.push_str(&format!("&pageToken={}", enc(token)));
    }
    let value = send_json(source, reqwest::Method::GET, &url, None).await?;
    tasks.extend(
      value
        .get("items")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|v| v.get("deleted").and_then(Value::as_bool) != Some(true))
        .filter_map(|v| map_task(list_id, v)),
    );
    page_token = str_field(&value, "nextPageToken");
    if page_token.is_none() {
      break;
    }
  }
  tasks.sort_by(|a, b| a.position.cmp(&b.position));
  Ok(tasks)
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct TaskInput {
  pub title: Option<String>,
  pub notes: Option<String>,
  pub status: Option<String>,
  pub due: Option<String>,
}

fn task_body(input: &TaskInput) -> Value {
  let mut body = serde_json::Map::new();
  if let Some(title) = &input.title {
    body.insert("title".into(), json!(title));
  }
  if let Some(notes) = &input.notes {
    body.insert("notes".into(), json!(notes));
  }
  if let Some(status) = &input.status {
    body.insert("status".into(), json!(status));
    if status == "needsAction" {
      // Reopening a task needs `completed` cleared as well.
      body.insert("completed".into(), Value::Null);
    }
  }
  if let Some(due) = &input.due {
    body.insert(
      "due".into(),
      if due.is_empty() {
        Value::Null
      } else {
        json!(due)
      },
    );
  }
  Value::Object(body)
}

pub async fn create_task(
  source: &GoogleSource,
  list_id: &str,
  input: &TaskInput,
) -> Result<GoogleTask, String> {
  let value = send_json(
    source,
    reqwest::Method::POST,
    &format!("{TASKS_API}/lists/{}/tasks", enc(list_id)),
    Some(&task_body(input)),
  )
  .await?;
  map_task(list_id, &value).ok_or_else(|| "Google returned an invalid task".to_string())
}

pub async fn update_task(
  source: &GoogleSource,
  list_id: &str,
  task_id: &str,
  input: &TaskInput,
) -> Result<GoogleTask, String> {
  let value = send_json(
    source,
    reqwest::Method::PATCH,
    &format!("{TASKS_API}/lists/{}/tasks/{}", enc(list_id), enc(task_id)),
    Some(&task_body(input)),
  )
  .await?;
  map_task(list_id, &value).ok_or_else(|| "Google returned an invalid task".to_string())
}

pub async fn delete_task(
  source: &GoogleSource,
  list_id: &str,
  task_id: &str,
) -> Result<(), String> {
  send(
    source,
    reqwest::Method::DELETE,
    &format!("{TASKS_API}/lists/{}/tasks/{}", enc(list_id), enc(task_id)),
    None,
  )
  .await
  .map(|_| ())
}

/// Moves a task to another list (a Kanban column) and/or after a sibling.
pub async fn move_task(
  source: &GoogleSource,
  list_id: &str,
  task_id: &str,
  destination_list_id: Option<&str>,
  previous_task_id: Option<&str>,
) -> Result<GoogleTask, String> {
  let mut url = format!(
    "{TASKS_API}/lists/{}/tasks/{}/move?",
    enc(list_id),
    enc(task_id)
  );
  if let Some(dest) = destination_list_id.filter(|d| *d != list_id) {
    url.push_str(&format!("destinationTasklist={}&", enc(dest)));
  }
  if let Some(previous) = previous_task_id {
    url.push_str(&format!("previous={}", enc(previous)));
  }
  let value = send_json(source, reqwest::Method::POST, &url, None).await?;
  let final_list = destination_list_id.unwrap_or(list_id);
  map_task(final_list, &value).ok_or_else(|| "Google returned an invalid task".to_string())
}

pub async fn create_task_list(
  source: &GoogleSource,
  title: &str,
) -> Result<GoogleTaskList, String> {
  let value = send_json(
    source,
    reqwest::Method::POST,
    &format!("{TASKS_API}/users/@me/lists"),
    Some(&json!({ "title": title })),
  )
  .await?;
  Ok(GoogleTaskList {
    id: str_field(&value, "id").ok_or("Google returned an invalid task list")?,
    title: str_field(&value, "title").unwrap_or_default(),
  })
}

// ---------------------------------------------------------------------------
// Google Drive / Docs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DriveFile {
  pub id: String,
  pub name: String,
  pub mime_type: String,
  pub modified_time: Option<String>,
  pub web_view_link: Option<String>,
  pub owner: Option<String>,
  /// Whether treq can export the file as text for review.
  pub reviewable: bool,
}

/// Google-native types are exported; plain text-like uploads are downloaded.
pub fn export_mime(mime: &str) -> Option<&'static str> {
  match mime {
    GOOGLE_DOC_MIME => Some("text/markdown"),
    "application/vnd.google-apps.presentation" => Some("text/plain"),
    "application/vnd.google-apps.spreadsheet" => Some("text/csv"),
    _ => None,
  }
}

fn is_text_like(mime: &str) -> bool {
  mime.starts_with("text/") || matches!(mime, "application/json" | "application/xml")
}

pub fn map_drive_file(v: &Value) -> Option<DriveFile> {
  let mime_type = str_field(v, "mimeType").unwrap_or_default();
  Some(DriveFile {
    id: str_field(v, "id")?,
    name: str_field(v, "name").unwrap_or_default(),
    reviewable: export_mime(&mime_type).is_some() || is_text_like(&mime_type),
    mime_type,
    modified_time: str_field(v, "modifiedTime"),
    web_view_link: str_field(v, "webViewLink"),
    owner: v
      .pointer("/owners/0/displayName")
      .and_then(Value::as_str)
      .map(str::to_string),
  })
}

/// Escapes a value for a Drive `q` string literal.
fn drive_literal(value: &str) -> String {
  value.replace('\\', "\\\\").replace('\'', "\\'")
}

pub fn drive_query(search: Option<&str>, docs_only: bool) -> String {
  let mut clauses = vec!["trashed = false".to_string()];
  if docs_only {
    clauses.push(format!("mimeType = '{GOOGLE_DOC_MIME}'"));
  } else {
    clauses.push("mimeType != 'application/vnd.google-apps.folder'".to_string());
  }
  if let Some(search) = search.map(str::trim).filter(|s| !s.is_empty()) {
    clauses.push(format!("fullText contains '{}'", drive_literal(search)));
  }
  clauses.join(" and ")
}

pub async fn list_drive_files(
  source: &GoogleSource,
  search: Option<&str>,
  docs_only: bool,
) -> Result<Vec<DriveFile>, String> {
  let q = drive_query(search, docs_only);
  // fullText search cannot be combined with orderBy.
  let order = if search.is_some_and(|s| !s.trim().is_empty()) {
    ""
  } else {
    "&orderBy=modifiedTime%20desc"
  };
  let url = format!(
    "{DRIVE_API}/files?pageSize=50&q={}{order}&fields={}&supportsAllDrives=true&includeItemsFromAllDrives=true",
    enc(&q),
    enc("files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName))")
  );
  let value = send_json(source, reqwest::Method::GET, &url, None).await?;
  Ok(
    value
      .get("files")
      .and_then(Value::as_array)
      .into_iter()
      .flatten()
      .filter_map(map_drive_file)
      .collect(),
  )
}

pub async fn get_drive_file(source: &GoogleSource, file_id: &str) -> Result<DriveFile, String> {
  let url = format!(
    "{DRIVE_API}/files/{}?supportsAllDrives=true&fields={}",
    enc(file_id),
    enc("id,name,mimeType,modifiedTime,webViewLink,owners(displayName)")
  );
  let value = send_json(source, reqwest::Method::GET, &url, None).await?;
  map_drive_file(&value).ok_or_else(|| "Google returned an invalid file".to_string())
}

pub async fn export_text(source: &GoogleSource, file: &DriveFile) -> Result<String, String> {
  let url = match export_mime(&file.mime_type) {
    Some(mime) => format!(
      "{DRIVE_API}/files/{}/export?mimeType={}",
      enc(&file.id),
      enc(mime)
    ),
    None if file.reviewable => format!(
      "{DRIVE_API}/files/{}?alt=media&supportsAllDrives=true",
      enc(&file.id)
    ),
    None => return Err(format!("'{}' cannot be reviewed as text", file.name)),
  };
  match send(source, reqwest::Method::GET, &url, None).await? {
    Body::Text(text) => Ok(text),
    Body::Json(value) => Ok(serde_json::to_string_pretty(&value).unwrap_or_default()),
  }
}

/// Posts one comment. `quoted` is the reviewed text the comment refers to;
/// Drive shows it as the comment's quote.
pub async fn create_comment(
  source: &GoogleSource,
  file_id: &str,
  content: &str,
  quoted: Option<&str>,
) -> Result<String, String> {
  let mut body = json!({ "content": content });
  if let Some(quoted) = quoted.filter(|q| !q.trim().is_empty()) {
    body["quotedFileContent"] = json!({ "mimeType": "text/plain", "value": quoted });
  }
  let value = send_json(
    source,
    reqwest::Method::POST,
    &format!("{DRIVE_API}/files/{}/comments?fields=id", enc(file_id)),
    Some(&body),
  )
  .await?;
  str_field(&value, "id").ok_or_else(|| "Google returned an invalid comment".to_string())
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

/// Drive ids are `[A-Za-z0-9_-]`; anything else could escape the review dir.
pub fn valid_file_id(id: &str) -> bool {
  !id.is_empty()
    && id
      .chars()
      .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn review_root(repo_path: &str, file_id: &str) -> Result<std::path::PathBuf, String> {
  if !valid_file_id(file_id) {
    return Err(format!("Invalid Google Drive file id '{file_id}'"));
  }
  Ok(
    std::path::Path::new(repo_path)
      .join(REVIEW_DIR)
      .join(file_id),
  )
}

pub fn review_file_name(file: &DriveFile) -> String {
  // Exports get the export format's extension; downloads keep their own.
  let (base, ext) = match export_mime(&file.mime_type) {
    Some("text/markdown") => (file.name.as_str(), "md"),
    Some("text/csv") => (file.name.as_str(), "csv"),
    Some(_) => (file.name.as_str(), "txt"),
    None => file
      .name
      .rsplit_once('.')
      .unwrap_or((file.name.as_str(), "txt")),
  };
  let safe = |s: &str| -> String {
    s.chars()
      .map(|c| {
        if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
          c
        } else {
          '-'
        }
      })
      .collect::<String>()
      .trim_matches('-')
      .chars()
      .take(60)
      .collect()
  };
  let stem = safe(base);
  let stem = if stem.is_empty() {
    "document".to_string()
  } else {
    stem
  };
  let ext = safe(ext);
  let ext = if ext.is_empty() {
    "txt".to_string()
  } else {
    ext
  };
  format!("{stem}.{ext}")
}

#[derive(Debug, Clone, Serialize)]
pub struct PreparedDocReview {
  pub file: DriveFile,
  /// Absolute directory the agent's `--file` is relative to.
  pub root: String,
  /// File name inside `root`.
  pub file_name: String,
  pub line_count: usize,
}

/// Exports the file into the review directory, replacing an earlier export.
pub async fn prepare_doc_review(
  source: &GoogleSource,
  repo_path: &str,
  file_id: &str,
) -> Result<PreparedDocReview, String> {
  let root = review_root(repo_path, file_id)?;
  let file = get_drive_file(source, file_id).await?;
  let text = export_text(source, &file).await?;
  let file_name = review_file_name(&file);
  if root.exists() {
    std::fs::remove_dir_all(&root).map_err(|e| format!("Failed to clear review directory: {e}"))?;
  }
  std::fs::create_dir_all(&root).map_err(|e| format!("Failed to create review directory: {e}"))?;
  std::fs::write(root.join(&file_name), &text)
    .map_err(|e| format!("Failed to write exported document: {e}"))?;
  // Unposted comments point at lines of the export just replaced.
  discard_open_comments(repo_path, file_id)?;
  Ok(PreparedDocReview {
    line_count: text.lines().count(),
    root: root.to_string_lossy().into_owned(),
    file_name,
    file,
  })
}

/// The exported lines a comment covers, trimmed for use as a Drive quote.
pub fn quoted_lines(text: &str, start: i64, end: i64) -> Option<String> {
  let start = start.max(1) as usize;
  let end = (end.max(start as i64)) as usize;
  let quote = text
    .lines()
    .skip(start - 1)
    .take(end - start + 1)
    .collect::<Vec<_>>()
    .join("\n");
  let quote = quote.trim();
  if quote.is_empty() {
    None
  } else {
    Some(quote.chars().take(1000).collect())
  }
}

pub fn comment_content(comment: &crate::local_db::AgentReviewComment) -> String {
  let mut content = comment.comment_text.trim().to_string();
  if let Some(suggestion) = comment
    .suggested_replacement
    .as_deref()
    .filter(|s| !s.trim().is_empty())
  {
    content.push_str("\n\nSuggested:\n");
    content.push_str(suggestion.trim());
  }
  content.push_str("\n\n— treq review agent");
  content
}

fn discard_open_comments(repo_path: &str, file_id: &str) -> Result<(), String> {
  for comment in
    crate::local_db::list_agent_review_comments(repo_path, REVIEW_TARGET_TYPE, file_id)?
  {
    if comment.status == "open" {
      crate::local_db::delete_agent_review_comment(repo_path, &comment.id)?;
    }
  }
  Ok(())
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct PostCommentsResult {
  pub posted: usize,
  /// One message per comment that was not posted; those stay open.
  pub errors: Vec<String>,
}

/// Posts the open agent comments for `file_id` to Drive. Each comment is
/// resolved before it is sent and reopened if sending fails, so a retry
/// never posts the same comment twice. A failure does not stop the rest.
pub async fn post_review_comments(
  source: &GoogleSource,
  repo_path: &str,
  file_id: &str,
) -> Result<PostCommentsResult, String> {
  let root = review_root(repo_path, file_id)?;
  let comments =
    crate::local_db::list_agent_review_comments(repo_path, REVIEW_TARGET_TYPE, file_id)?;
  let mut result = PostCommentsResult::default();
  for comment in comments.iter().filter(|c| c.status == "open") {
    crate::local_db::resolve_agent_review_comment(repo_path, &comment.id)?;
    let text = std::fs::read_to_string(root.join(&comment.file_path)).unwrap_or_default();
    let quote = quoted_lines(&text, comment.start_line, comment.end_line);
    match create_comment(source, file_id, &comment_content(comment), quote.as_deref()).await {
      Ok(_) => result.posted += 1,
      Err(e) => {
        crate::local_db::reopen_agent_review_comment(repo_path, &comment.id)?;
        result.errors.push(e);
      }
    }
  }
  Ok(result)
}

#[cfg(test)]
mod tests {
  use super::*;
  use wiremock::matchers::{body_partial_json, method, path, query_param};
  use wiremock::{Mock, MockServer, ResponseTemplate};

  fn local(token: &str) -> GoogleSource {
    GoogleSource::Local {
      tokens: StoredTokens {
        access_token: token.into(),
        refresh_token: None,
        expires_at: None,
      },
      client_id: "cid".into(),
      client_secret: None,
      token_db: None,
    }
  }

  async fn mock() -> MockServer {
    let server = MockServer::start().await;
    TEST_BASE.with(|b| *b.borrow_mut() = Some(server.uri()));
    server
  }

  #[test]
  fn base64url_matches_rfc4648_vectors() {
    assert_eq!(base64url(b""), "");
    assert_eq!(base64url(b"f"), "Zg");
    assert_eq!(base64url(b"fo"), "Zm8");
    assert_eq!(base64url(b"foo"), "Zm9v");
    assert_eq!(base64url(b"foob"), "Zm9vYg");
    assert_eq!(base64url(&[0xfb, 0xff]), "-_8");
  }

  #[test]
  fn pkce_challenge_matches_rfc7636_example() {
    assert_eq!(
      pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
  }

  #[test]
  fn authorize_url_requests_offline_pkce_grant() {
    let url = authorize_url("cid", "http://127.0.0.1:5000", "st", "ch");
    for part in [
      "client_id=cid",
      "code_challenge=ch",
      "code_challenge_method=S256",
      "access_type=offline",
      "state=st",
      "redirect_uri=http%3A%2F%2F127.0.0.1%3A5000",
    ] {
      assert!(url.contains(part), "{url} missing {part}");
    }
  }

  #[test]
  fn parse_redirect_checks_state() {
    assert_eq!(
      parse_redirect("GET /?state=abc&code=xyz HTTP/1.1", "abc").unwrap(),
      "xyz"
    );
    assert!(parse_redirect("GET /?state=bad&code=xyz HTTP/1.1", "abc").is_err());
    assert!(
      parse_redirect("GET /?error=access_denied&state=abc HTTP/1.1", "abc")
        .unwrap_err()
        .contains("access_denied")
    );
  }

  #[test]
  fn local_tokens_win_over_proxy() {
    let tokens = StoredTokens {
      access_token: "a".into(),
      refresh_token: None,
      expires_at: None,
    };
    let session = ProxySession {
      supabase_url: "u".into(),
      access_token: "t".into(),
    };
    assert!(matches!(
      choose_source(
        Some(tokens.clone()),
        Some("cid".into()),
        None,
        Some(session.clone())
      ),
      Ok(GoogleSource::Local { .. })
    ));
    assert!(matches!(
      choose_source(None, None, None, Some(session)),
      Ok(GoogleSource::Proxy(_))
    ));
    assert!(choose_source(Some(tokens), None, None, None).is_err());
  }

  #[test]
  fn grant_keeps_previous_refresh_token() {
    let tokens = tokens_from_grant(
      &json!({"access_token": "new", "expires_in": 3600}),
      Some("old-refresh".into()),
    )
    .unwrap();
    assert_eq!(tokens.refresh_token.as_deref(), Some("old-refresh"));
    assert!(tokens.expires_at.unwrap() > now_secs());
  }

  #[test]
  fn drive_query_escapes_search() {
    assert_eq!(
      drive_query(Some("it's"), true),
      format!("trashed = false and mimeType = '{GOOGLE_DOC_MIME}' and fullText contains 'it\\'s'")
    );
  }

  #[test]
  fn review_root_rejects_path_traversal() {
    assert!(review_root("/repo", "../etc").is_err());
    assert!(review_root("/repo", "").is_err());
    assert_eq!(
      review_root("/repo", "abc_D-1").unwrap(),
      std::path::Path::new("/repo/.treq/google-review/abc_D-1")
    );
  }

  #[test]
  fn review_file_name_is_safe() {
    let doc =
      map_drive_file(&json!({"id": "1", "name": "Q3 plan / draft", "mimeType": GOOGLE_DOC_MIME}))
        .unwrap();
    assert!(doc.reviewable);
    assert_eq!(review_file_name(&doc), "Q3-plan---draft.md");
    let txt =
      map_drive_file(&json!({"id": "1", "name": "notes.txt", "mimeType": "text/plain"})).unwrap();
    assert_eq!(review_file_name(&txt), "notes.txt");
    let pdf =
      map_drive_file(&json!({"id": "1", "name": "a.pdf", "mimeType": "application/pdf"})).unwrap();
    assert!(!pdf.reviewable);
  }

  #[test]
  fn quoted_lines_covers_range() {
    let text = "one\ntwo\nthree\n";
    assert_eq!(quoted_lines(text, 2, 3).as_deref(), Some("two\nthree"));
    assert_eq!(quoted_lines(text, 3, 1).as_deref(), Some("three"));
    assert_eq!(quoted_lines(text, 9, 9), None);
  }

  #[tokio::test]
  async fn lists_tasks_across_pages_sorted_by_position() {
    let server = mock().await;
    Mock::given(method("GET"))
      .and(path("/tasks/v1/lists/L1/tasks"))
      .and(query_param("pageToken", "p2"))
      .respond_with(ResponseTemplate::new(200).set_body_json(json!({
        "items": [{"id": "a", "title": "A", "status": "needsAction", "position": "001"}]
      })))
      .mount(&server)
      .await;
    Mock::given(method("GET"))
      .and(path("/tasks/v1/lists/L1/tasks"))
      .respond_with(ResponseTemplate::new(200).set_body_json(json!({
        "items": [
          {"id": "b", "title": "B", "status": "completed", "position": "002"},
          {"id": "gone", "title": "x", "deleted": true, "position": "000"}
        ],
        "nextPageToken": "p2"
      })))
      .mount(&server)
      .await;
    let tasks = list_tasks(&local("tok"), "L1").await.unwrap();
    let ids: Vec<_> = tasks.iter().map(|t| t.id.as_str()).collect();
    assert_eq!(ids, ["a", "b"]);
    assert_eq!(tasks[1].status, "completed");
  }

  #[tokio::test]
  async fn moves_task_to_another_list() {
    let server = mock().await;
    Mock::given(method("POST"))
      .and(path("/tasks/v1/lists/L1/tasks/t1/move"))
      .and(query_param("destinationTasklist", "L2"))
      .respond_with(
        ResponseTemplate::new(200)
          .set_body_json(json!({"id": "t1", "title": "T", "position": "1"})),
      )
      .expect(1)
      .mount(&server)
      .await;
    let task = move_task(&local("tok"), "L1", "t1", Some("L2"), None)
      .await
      .unwrap();
    assert_eq!(task.list_id, "L2");
  }

  #[tokio::test]
  async fn reopening_task_clears_completed() {
    let server = mock().await;
    Mock::given(method("PATCH"))
      .and(path("/tasks/v1/lists/L1/tasks/t1"))
      .and(body_partial_json(
        json!({"status": "needsAction", "completed": null}),
      ))
      .respond_with(
        ResponseTemplate::new(200).set_body_json(json!({"id": "t1", "status": "needsAction"})),
      )
      .expect(1)
      .mount(&server)
      .await;
    let input = TaskInput {
      status: Some("needsAction".into()),
      ..Default::default()
    };
    update_task(&local("tok"), "L1", "t1", &input)
      .await
      .unwrap();
  }

  #[tokio::test]
  async fn google_errors_surface_their_message() {
    let server = mock().await;
    Mock::given(method("GET"))
      .and(path("/tasks/v1/users/@me/lists"))
      .respond_with(
        ResponseTemplate::new(403)
          .set_body_json(json!({"error": {"message": "Tasks API disabled"}})),
      )
      .mount(&server)
      .await;
    let err = list_task_lists(&local("tok")).await.unwrap_err();
    assert_eq!(err, "Google: Tasks API disabled");
  }

  #[tokio::test]
  async fn expired_local_token_is_refreshed() {
    let server = mock().await;
    Mock::given(method("POST"))
      .and(path("/token"))
      .respond_with(
        ResponseTemplate::new(200)
          .set_body_json(json!({"access_token": "fresh", "expires_in": 3600})),
      )
      .expect(1)
      .mount(&server)
      .await;
    let tokens = StoredTokens {
      access_token: "stale".into(),
      refresh_token: Some("r".into()),
      expires_at: Some(now_secs() - 10),
    };
    let token = local_access_token(&tokens, "cid", &None, &None)
      .await
      .unwrap();
    assert_eq!(token, "fresh");
  }

  #[tokio::test]
  async fn exports_google_doc_as_markdown() {
    let server = mock().await;
    Mock::given(method("GET"))
      .and(path("/drive/v3/files/doc1/export"))
      .and(query_param("mimeType", "text/markdown"))
      .respond_with(ResponseTemplate::new(200).set_body_raw("# Title\nBody\n", "text/markdown"))
      .mount(&server)
      .await;
    let file =
      map_drive_file(&json!({"id": "doc1", "name": "Spec", "mimeType": GOOGLE_DOC_MIME})).unwrap();
    assert_eq!(
      export_text(&local("tok"), &file).await.unwrap(),
      "# Title\nBody\n"
    );
  }

  #[tokio::test]
  async fn comment_carries_quote() {
    let server = mock().await;
    Mock::given(method("POST"))
      .and(path("/drive/v3/files/doc1/comments"))
      .and(body_partial_json(
        json!({"content": "fix", "quotedFileContent": {"value": "Body"}}),
      ))
      .respond_with(ResponseTemplate::new(200).set_body_json(json!({"id": "c1"})))
      .expect(1)
      .mount(&server)
      .await;
    let id = create_comment(&local("tok"), "doc1", "fix", Some("Body"))
      .await
      .unwrap();
    assert_eq!(id, "c1");
  }

  fn add_comment(repo: &str, file_id: &str, text: &str) -> String {
    crate::local_db::create_agent_review_comment(
      repo,
      REVIEW_TARGET_TYPE,
      file_id,
      "doc.md",
      None,
      1,
      1,
      None,
      text,
      None,
      "local-agent",
    )
    .unwrap()
    .id
  }

  fn statuses(repo: &str, file_id: &str) -> Vec<(String, String)> {
    crate::local_db::list_agent_review_comments(repo, REVIEW_TARGET_TYPE, file_id)
      .unwrap()
      .into_iter()
      .map(|c| (c.comment_text, c.status))
      .collect()
  }

  #[tokio::test]
  async fn posting_continues_past_a_failure_and_reopens_it() {
    let server = mock().await;
    let dir = tempfile::tempdir().unwrap();
    let repo = dir.path().to_str().unwrap();
    let root = review_root(repo, "doc1").unwrap();
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("doc.md"), "Line one\n").unwrap();
    add_comment(repo, "doc1", "bad");
    add_comment(repo, "doc1", "good");
    Mock::given(method("POST"))
      .and(path("/drive/v3/files/doc1/comments"))
      .and(body_partial_json(
        json!({"quotedFileContent": {"mimeType": "text/plain", "value": "Line one"}}),
      ))
      .and(wiremock::matchers::body_string_contains("bad"))
      .respond_with(ResponseTemplate::new(500).set_body_json(json!({"error": {"message": "boom"}})))
      .mount(&server)
      .await;
    Mock::given(method("POST"))
      .and(path("/drive/v3/files/doc1/comments"))
      .respond_with(ResponseTemplate::new(200).set_body_json(json!({"id": "c"})))
      .mount(&server)
      .await;

    let result = post_review_comments(&local("tok"), repo, "doc1")
      .await
      .unwrap();
    assert_eq!(result.posted, 1);
    assert_eq!(result.errors, ["Google: boom"]);
    let mut states = statuses(repo, "doc1");
    states.sort();
    assert_eq!(
      states,
      [
        ("bad".into(), "open".into()),
        ("good".into(), "resolved".into())
      ]
    );
  }

  #[tokio::test]
  async fn re_export_discards_unposted_comments_only() {
    let server = mock().await;
    let dir = tempfile::tempdir().unwrap();
    let repo = dir.path().to_str().unwrap();
    std::fs::create_dir_all(review_root(repo, "doc1").unwrap()).unwrap();
    add_comment(repo, "doc1", "stale");
    let posted = add_comment(repo, "doc1", "posted");
    crate::local_db::resolve_agent_review_comment(repo, &posted).unwrap();
    Mock::given(method("GET"))
      .and(path("/drive/v3/files/doc1"))
      .respond_with(
        ResponseTemplate::new(200)
          .set_body_json(json!({"id": "doc1", "name": "Spec", "mimeType": GOOGLE_DOC_MIME})),
      )
      .mount(&server)
      .await;
    Mock::given(method("GET"))
      .and(path("/drive/v3/files/doc1/export"))
      .respond_with(ResponseTemplate::new(200).set_body_raw("# New\n", "text/markdown"))
      .mount(&server)
      .await;

    let prepared = prepare_doc_review(&local("tok"), repo, "doc1")
      .await
      .unwrap();
    assert_eq!(prepared.file_name, "Spec.md");
    assert_eq!(
      statuses(repo, "doc1"),
      [("posted".into(), "resolved".into())]
    );
  }

  #[test]
  fn proxy_reconnect_message_is_kept() {
    let status = reqwest::StatusCode::UNAUTHORIZED;
    assert_eq!(
      error_message(
        status,
        r#"{"error":"Google authorization expired. Reconnect."}"#,
        true
      ),
      "Google authorization expired. Reconnect."
    );
    assert!(error_message(status, "", true).contains("Sign in to treq again"));
    assert!(error_message(status, "", false).contains("Reconnect Google Workspace"));
  }
}
