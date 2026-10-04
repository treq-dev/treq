//! Google Workspace client: Google Tasks and Google Drive (which also covers
//! Google Docs, exported as text for review).
//!
//! Pro only: the `google-oauth` Edge Functions hold the user's Google grant
//! and `google-proxy` forwards each request, so no token reaches the device.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::OnceLock;
use std::time::Duration;

pub const TASKS_API: &str = "https://tasks.googleapis.com/tasks/v1";
pub const DRIVE_API: &str = "https://www.googleapis.com/drive/v3";

/// Under the user's Documents folder: exports never land inside a repo,
/// where jj would snapshot private document contents into a change.
pub const EXPORTS_DIR: &str = "treq/exports";
pub const REVIEW_TARGET_TYPE: &str = "google_doc";
pub const GOOGLE_DOC_MIME: &str = "application/vnd.google-apps.document";

const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Exports and other responses larger than this are refused.
pub const MAX_RESPONSE_BYTES: u64 = 20 * 1024 * 1024;
/// Pages followed when listing tasks or task lists, and Drive files.
const MAX_TASK_PAGES: usize = 50;
const MAX_DRIVE_PAGES: usize = 4;

mod drive;
mod http;
mod tasks;
#[cfg(test)]
pub(crate) mod tests;

pub use drive::*;
pub(crate) use http::*;
pub use tasks::*;

pub use crate::proxy_session::ProxySession;

#[derive(Clone)]
pub enum GoogleSource {
  Proxy(ProxySession),
  /// Test-only: calls Google URLs (rewritten to a mock server) directly.
  #[cfg(test)]
  Direct,
}

pub(crate) fn non_empty(value: Option<String>) -> Option<String> {
  value
    .map(|v| v.trim().to_string())
    .filter(|v| !v.is_empty())
}

pub const NOT_CONNECTED: &str =
  "Google Workspace is not connected. Sign in to treq Pro and connect it in Settings > Integrations.";

/// The Pro proxy session, the only way to reach Google.
pub fn resolve_source() -> Result<GoogleSource, String> {
  crate::proxy_session::get()
    .map(GoogleSource::Proxy)
    .ok_or_else(|| NOT_CONNECTED.to_string())
}

/// Which source requests would use.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionMode {
  Proxy,
  None,
}

/// Connection state shown in settings.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct GoogleConnectionStatus {
  pub mode: ConnectionMode,
}

/// A signed-in treq session only counts as connected once `google-proxy`
/// confirms it holds a Google grant for it.
pub async fn connection_status(source: Result<GoogleSource, String>) -> GoogleConnectionStatus {
  let mode = match source {
    Ok(GoogleSource::Proxy(session)) if proxy_linked(&session).await => ConnectionMode::Proxy,
    _ => ConnectionMode::None,
  };
  GoogleConnectionStatus { mode }
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
