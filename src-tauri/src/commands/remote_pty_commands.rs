//! Tauri command surface for native remote PTY sessions (shell/agent) over
//! SSH — the product-facing API for `crate::core::remote_pty::RemotePtyManager`.
//! Mirrors `commands::pty_commands`'s event and error conventions so a
//! caller who already knows the local terminal API is not learning a second
//! vocabulary.

use crate::core::feature_preview::PreviewFeature;
use crate::core::remote::TreqCommandRequest;
use crate::core::remote_control_plane::SshEndpoint;
use crate::core::remote_pty::{PtyLaunchSpec, RemotePtyBinding, RemotePtyError, RemotePtyManager};
use crate::core::remote_ssh_transport::{CancellationToken, ExecLimits};
use crate::pty::Utf8StreamDecoder;
use crate::AppState;
use serde::Serialize;
use tauri::{Emitter, State};

/// Shared remote PTY session manager, keyed by the same `RemoteExecState`
/// connection pool used by structured exec dispatch, so shell/agent PTYs
/// reuse the endpoint's pooled SSH connection rather than opening a new one.
pub struct RemotePtyState(pub RemotePtyManager);

impl RemotePtyState {
  pub fn new(exec_state: &crate::commands::remote_control::RemoteExecState) -> Self {
    Self(RemotePtyManager::new(exec_state.0.clone()))
  }
}

/// Default construction (a fresh, unshared connection pool) so the
/// `tauri_test`/NAPI bridge — which manages `State<T>` for any `T: Default`
/// it discovers via the registered command list — can stand this state up
/// without duplicating `lib.rs`'s real wiring. Production startup always
/// uses [`RemotePtyState::new`] against the same pool `RemoteExecState`
/// already manages, so PTYs and structured exec commands share one
/// connection per endpoint.
impl Default for RemotePtyState {
  fn default() -> Self {
    Self(RemotePtyManager::new(std::sync::Arc::new(
      crate::core::remote_ssh_transport::SshConnectionPool::new(),
    )))
  }
}

/// Tauri event emitted with each output chunk from a remote PTY session,
/// named `remote-pty-data-<session_id>` — same per-session-suffixed naming
/// convention as the local `pty-data-<session_id>` event.
fn data_event_name(session_id: &str) -> String {
  format!("remote-pty-data-{session_id}")
}

/// Tauri event emitted exactly once when a remote PTY session's process
/// exits (or its channel otherwise ends), named `remote-pty-exit-<session_id>`.
fn exit_event_name(session_id: &str) -> String {
  format!("remote-pty-exit-{session_id}")
}

#[derive(Debug, Clone, Serialize)]
pub struct RemotePtyExitPayload {
  pub exit_status: Option<u32>,
}

fn remote_pty_error_to_string(error: RemotePtyError) -> String {
  error.to_string()
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn remote_pty_create(
  app: tauri::AppHandle,
  session_id: String,
  window_label: Option<String>,
  endpoint: SshEndpoint,
  repository_id: String,
  workspace_id: String,
  remote_working_directory: String,
  launch: PtyLaunchSpec,
  cols: u16,
  rows: u16,
  state: State<'_, RemotePtyState>,
  app_state: State<'_, AppState>,
) -> Result<(), String> {
  crate::commands::feature_preview::require(&app_state, PreviewFeature::RemoteSsh)?;
  log::debug!(
    "remote_pty_create: session_id={}, endpoint_id={}, repository_id={}, workspace_id={}",
    session_id,
    endpoint.id,
    repository_id,
    workspace_id
  );
  let manager = state.0.clone();
  let binding = RemotePtyBinding {
    endpoint_id: endpoint.id.clone(),
    repository_id,
    workspace_id,
    remote_working_directory,
    local_session_id: session_id.clone(),
    window_label,
  };

  let data_event = data_event_name(&session_id);
  let exit_event = exit_event_name(&session_id);
  let app_for_data = app.clone();
  let app_for_decoder_exit = app.clone();
  let sid_for_data = session_id.clone();
  let app_for_exit = app;
  let sid_for_exit = session_id.clone();
  let decoder = std::sync::Arc::new(std::sync::Mutex::new(Utf8StreamDecoder::new()));
  let data_decoder = decoder.clone();
  let exit_decoder = decoder;
  let data_event_for_exit = data_event.clone();

  manager
    .create(
      binding,
      &endpoint,
      launch,
      cols,
      rows,
      move |chunk| {
        // Never log raw terminal data (PRD "never log raw terminal output ...
        // by default"); only the event name/session id are logged, in
        // `remote_pty_create`'s entry line above.
        let decoded = data_decoder.lock().unwrap().push(&chunk);
        if !decoded.is_empty() {
          if let Err(error) = app_for_data.emit(&data_event, decoded) {
            log::warn!(
              "remote pty emit failed: session_id={}, event={}, error={}",
              sid_for_data,
              data_event,
              error
            );
          }
        }
      },
      move |exit_status| {
        let trailing = exit_decoder.lock().unwrap().finish();
        if !trailing.is_empty() {
          let _ = app_for_decoder_exit.emit(&data_event_for_exit, trailing);
        }
        if let Err(error) = app_for_exit.emit(&exit_event, RemotePtyExitPayload { exit_status }) {
          log::warn!(
            "remote pty exit emit failed: session_id={}, event={}, error={}",
            sid_for_exit,
            exit_event,
            error
          );
        }
      },
    )
    .await
    .map_err(remote_pty_error_to_string)
}

#[tauri::command]
pub async fn remote_pty_write(
  session_id: String,
  data: String,
  state: State<'_, RemotePtyState>,
) -> Result<(), String> {
  state
    .0
    .write(&session_id, data.as_bytes())
    .await
    .map_err(remote_pty_error_to_string)
}

#[tauri::command]
pub async fn remote_pty_resize(
  session_id: String,
  cols: u16,
  rows: u16,
  state: State<'_, RemotePtyState>,
) -> Result<(), String> {
  state
    .0
    .resize(&session_id, cols, rows)
    .await
    .map_err(remote_pty_error_to_string)
}

#[tauri::command]
pub async fn remote_pty_close(
  session_id: String,
  state: State<'_, RemotePtyState>,
) -> Result<(), String> {
  state
    .0
    .close(&session_id)
    .await
    .map_err(remote_pty_error_to_string)
}

#[tauri::command]
pub fn remote_pty_session_exists(
  session_id: String,
  state: State<'_, RemotePtyState>,
) -> Result<bool, String> {
  Ok(state.0.session_exists(&session_id))
}

// -- Phase 8: desktop parity with mobile's persistent-session reattach ------
//
// Desktop already had a working single-session remote PTY (the commands
// above); what it lacked was any notion of a session surviving past this
// process's lifetime. These two commands wrap the same `pty-remote`
// VM-local supervisor (Phase 7, item 1) mobile uses, via the same generic
// `TreqCommandRequest` dispatch (`core::remote::execute_remote_command`)
// `remote_dispatch_over_ssh` already exposes — `PtyList`/`PtyStop`/
// `PtyStart` need no dedicated command at all for that reason, only
// `remote_dispatch_over_ssh` with the right request. `remote_pty_reattach`
// is the one operation that is not just "run a typed request and return
// JSON": it must also open a live PTY channel with the command that
// request returns, so it gets its own command here.

/// Lists persistent `pty-remote` sessions on `endpoint`, optionally scoped
/// to `workspace_id`. A thin convenience wrapper over `remote_dispatch_over_ssh`
/// with `TreqCommandRequest::PtyList` — kept here (rather than requiring
/// every caller to build that request by hand) because "what sessions can
/// I reattach to" is this module's concern.
#[tauri::command]
pub async fn remote_pty_list_persistent_sessions(
  endpoint: SshEndpoint,
  repo: String,
  workspace_id: Option<String>,
  exec_state: State<'_, crate::commands::remote_control::RemoteExecState>,
  app_state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
  crate::commands::feature_preview::require(&app_state, PreviewFeature::RemoteSsh)?;
  let cancellation = CancellationToken::new();
  crate::core::remote::execute_remote_command::<serde_json::Value>(
    &exec_state.0,
    &endpoint,
    TreqCommandRequest::PtyList {
      repo,
      workspace: workspace_id,
    },
    ExecLimits::default(),
    &cancellation,
  )
  .await
  .map_err(|e| e.to_string())
}

/// Reattaches to (creating first if necessary) a persistent `pty-remote`
/// session identified by `label`: fetches the literal attach command from
/// the VM (`TreqCommandRequest::PtyAttachCommand`) and opens a live PTY
/// channel with it, emitting the same `remote-pty-data-<session_id>` /
/// `remote-pty-exit-<session_id>` events `remote_pty_create` does — a
/// caller (the remote-review terminal UI) does not need a separate code
/// path for "reattach" vs. "fresh session".
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn remote_pty_reattach(
  app: tauri::AppHandle,
  session_id: String,
  window_label: Option<String>,
  endpoint: SshEndpoint,
  repository_id: String,
  workspace_id: String,
  label: String,
  remote_working_directory: String,
  launch: PtyLaunchSpec,
  cols: u16,
  rows: u16,
  pty_state: State<'_, RemotePtyState>,
  exec_state: State<'_, crate::commands::remote_control::RemoteExecState>,
  app_state: State<'_, AppState>,
) -> Result<(), String> {
  crate::commands::feature_preview::require(&app_state, PreviewFeature::RemoteSsh)?;
  let cancellation = CancellationToken::new();
  let attach_command = crate::core::remote::execute_remote_command::<String>(
    &exec_state.0,
    &endpoint,
    TreqCommandRequest::PtyAttachCommand {
      repo: repository_id.clone(),
      workspace: workspace_id.clone(),
      label,
      remote_dir: remote_working_directory.clone(),
      launch,
      cols,
      rows,
    },
    ExecLimits::default(),
    &cancellation,
  )
  .await
  .map_err(|e| e.to_string())?;

  let manager = pty_state.0.clone();
  let binding = RemotePtyBinding {
    endpoint_id: endpoint.id.clone(),
    repository_id,
    workspace_id,
    remote_working_directory,
    local_session_id: session_id.clone(),
    window_label,
  };

  let data_event = data_event_name(&session_id);
  let exit_event = exit_event_name(&session_id);
  let app_for_data = app.clone();
  let sid_for_data = session_id.clone();
  let app_for_exit = app;
  let sid_for_exit = session_id;

  manager
    .create_with_command(
      binding,
      &endpoint,
      &attach_command,
      cols,
      rows,
      move |chunk| {
        if let Err(error) =
          app_for_data.emit(&data_event, String::from_utf8_lossy(&chunk).into_owned())
        {
          log::warn!(
            "remote pty emit failed: session_id={}, event={}, error={}",
            sid_for_data,
            data_event,
            error
          );
        }
      },
      move |exit_status| {
        if let Err(error) = app_for_exit.emit(&exit_event, RemotePtyExitPayload { exit_status }) {
          log::warn!(
            "remote pty exit emit failed: session_id={}, event={}, error={}",
            sid_for_exit,
            exit_event,
            error
          );
        }
      },
    )
    .await
    .map_err(remote_pty_error_to_string)
}
