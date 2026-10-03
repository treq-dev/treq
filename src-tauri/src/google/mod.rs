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

/// Under the user's Documents folder: exports never land inside a repo,
/// where jj would snapshot private document contents into a change.
pub const EXPORTS_DIR: &str = "treq/exports";
pub const REVIEW_TARGET_TYPE: &str = "google_doc";
pub const GOOGLE_DOC_MIME: &str = "application/vnd.google-apps.document";

const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
// Refresh a little early so a token cannot expire mid-request.
const REFRESH_MARGIN_SECS: i64 = 60;

mod drive;
mod http;
mod oauth;
mod tasks;
#[cfg(test)]
pub(crate) mod tests;

pub use drive::*;
pub(crate) use http::*;
pub use oauth::*;
pub use tasks::*;

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

pub(crate) fn non_empty(value: Option<String>) -> Option<String> {
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
