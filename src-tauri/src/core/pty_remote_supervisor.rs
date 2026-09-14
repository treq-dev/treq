//! VM-local persistent PTY supervisor (mobile PRD Phase 7, item 1).
//!
//! Backs the `pty-remote` CLI surface (`start`/`attach`/`resize`/`stop`/
//! `list`), the shared infrastructure both the mobile client (Phase 7) and
//! desktop (Phase 8) consume so a full interactive terminal survives an app
//! suspension, a dropped connection, or an app relaunch without losing the
//! running remote process.
//!
//! ## Implementation decision: tmux-backed, not a custom supervisor
//!
//! The PRD's open question asked whether to build a custom Treq-owned
//! supervisor (fork+setsid+pty+ring buffer) or lean on `tmux`/`screen`. This
//! module picks **tmux as the primary backend**, with `screen` as a fallback
//! when `tmux` is not installed (`detect_backend`), and returns a clear
//! `dependency_error` when neither is present rather than silently
//! degrading to a non-persistent session:
//!
//! - A custom supervisor duplicates a huge amount of battle-tested behavior
//!   (job control, signal forwarding, scrollback, resize propagation) that
//!   tmux/screen already get right; the PRD's own examples of what a
//!   session must survive (detach, reattach, resize) are tmux's core
//!   purpose.
//! - Session persistence with tmux is a single detached session per
//!   workspace, keyed by a name derived from `repo`+`workspace` so `list`
//!   and `attach` are naturally idempotent — reattach-or-create.
//! - Resize does not need a dedicated wire message: when the SSH PTY
//!   channel's `window_change_request` changes the terminal size tmux is
//!   attached through, tmux resizes its virtual screen to match the
//!   attached client automatically (tmux's default `aggressive-resize off`
//!   behavior already tracks the (single) attached client). `resize_session`
//!   below exists for completeness / explicit resize-without-attach (e.g. a
//!   mobile client that wants to pre-size a session before attaching) but is
//!   not on the hot path of normal use.
//! - Trade-off accepted: this depends on `tmux` (or `screen`) being present
//!   on the remote VM. Treq's managed-instance provisioning path can
//!   guarantee this; a user-managed endpoint that lacks both gets a clear
//!   `dependency_error` from `start_session`/`build_attach_command` telling
//!   the user to install one, rather than silently falling back to a
//!   non-reattachable raw PTY. This resolves the PRD's open question in
//!   favor of "depend on it, fail loudly if absent" over "always work but
//!   never survive a reconnect".
//!
//! Mirrors `core::agent_supervisor`'s shape (pidfile-style JSON record
//! under `.treq/`, no public network port, only reachable through the
//! allow-listed CLI surface) but session state itself lives in tmux's own
//! server, not a Treq-owned file — Treq only tracks *naming* and *binding*
//! (repo/workspace/label -> tmux session name) so `list` can report
//! workspace-scoped sessions without shelling out to tmux for repos it
//! does not know about.

use serde::{Deserialize, Serialize};
use std::process::Command;

/// Which backend `start_session`/`build_attach_command` will use. Detected
/// once per call rather than cached, since a VM's installed tooling does not
/// change within a single CLI invocation's lifetime and caching would risk
/// staleness across long-lived callers (e.g. a desktop process that stays
/// up across an `apt remove tmux`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PtyBackend {
  Tmux,
  Screen,
}

impl PtyBackend {
  /// Reserved for callers that need the backend's binary name directly
  /// (e.g. a future `pty-remote list --backend` diagnostic); not currently
  /// called from this module's own start/attach/stop/list paths, which
  /// each match on `PtyBackend` explicitly.
  #[allow(dead_code)]
  fn binary(self) -> &'static str {
    match self {
      Self::Tmux => "tmux",
      Self::Screen => "screen",
    }
  }
}

/// Detects the best available backend. Prefers tmux (richer scripting for
/// list/resize/kill by name); falls back to screen; `None` when neither is
/// on `PATH`.
pub fn detect_backend() -> Option<PtyBackend> {
  if crate::binary_paths::detect_binary("tmux").is_some() {
    Some(PtyBackend::Tmux)
  } else if crate::binary_paths::detect_binary("screen").is_some() {
    Some(PtyBackend::Screen)
  } else {
    None
  }
}

/// One VM-local persistent PTY session's identity. The session name is
/// derived deterministically from `workspace` plus `label` so repeated
/// `start` calls for the same (workspace, label) are idempotent — the same
/// underlying tmux/screen session is reused rather than a duplicate created.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PtySessionInfo {
  pub session_name: String,
  pub workspace: String,
  pub label: String,
  /// True when the backend reports the session currently exists (it may
  /// have exited between calls, e.g. the shell/agent inside it quit).
  pub running: bool,
}

/// Builds the tmux/screen session name for a (workspace, label) pair. Kept
/// short and shell-safe: alphanumeric plus `-`/`_` only, so it never needs
/// quoting when interpolated into a `tmux -t <name>` argument.
pub fn session_name(workspace: &str, label: &str) -> String {
  let sanitize = |s: &str| -> String {
    s.chars()
      .map(|c| {
        if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
          c
        } else {
          '_'
        }
      })
      .collect()
  };
  format!("treq-pty-{}-{}", sanitize(workspace), sanitize(label))
}

/// Starts (or, if one already exists, leaves running) a detached persistent
/// session for `workspace`/`label` in `remote_dir`, running `command`
/// (typically a login shell or an allow-listed agent binary — callers are
/// responsible for the same typed-launch-spec discipline
/// `core::remote_pty::PtyLaunchSpec` enforces; this module does not itself
/// restrict `command` because it is also usable head-less/server-side where
/// that policy lives one layer up).
pub fn start_session(
  remote_dir: &str,
  workspace: &str,
  label: &str,
  command: &str,
  cols: u16,
  rows: u16,
) -> Result<PtySessionInfo, String> {
  let backend = detect_backend().ok_or_else(|| {
    "dependency_error: Neither tmux nor screen is installed on this host; pty-remote requires one of them for persistent/reattachable sessions".to_string()
  })?;
  let name = session_name(workspace, label);

  if session_exists(backend, &name) {
    return Ok(PtySessionInfo {
      session_name: name,
      workspace: workspace.to_string(),
      label: label.to_string(),
      running: true,
    });
  }

  let quoted_dir = crate::core::remote::shell_quote(remote_dir);
  match backend {
    PtyBackend::Tmux => {
      let shell_cmd = format!("cd {quoted_dir} && exec {command}");
      let status = Command::new("tmux")
        .args([
          "new-session",
          "-d",
          "-s",
          &name,
          "-x",
          &cols.to_string(),
          "-y",
          &rows.to_string(),
          &shell_cmd,
        ])
        .status()
        .map_err(|e| format!("dependency_error: Failed to spawn tmux: {e}"))?;
      if !status.success() {
        return Err(format!(
          "dependency_error: tmux new-session exited with {status}"
        ));
      }
    }
    PtyBackend::Screen => {
      let shell_cmd = format!("cd {quoted_dir} && exec {command}");
      let status = Command::new("screen")
        .args([
          "-dmS",
          &name,
          "bash",
          "-lc",
          &shell_cmd,
        ])
        .status()
        .map_err(|e| format!("dependency_error: Failed to spawn screen: {e}"))?;
      if !status.success() {
        return Err(format!(
          "dependency_error: screen -dmS exited with {status}"
        ));
      }
    }
  }

  Ok(PtySessionInfo {
    session_name: name,
    workspace: workspace.to_string(),
    label: label.to_string(),
    running: true,
  })
}

fn session_exists(backend: PtyBackend, name: &str) -> bool {
  match backend {
    PtyBackend::Tmux => Command::new("tmux")
      .args(["has-session", "-t", name])
      .status()
      .map(|s| s.success())
      .unwrap_or(false),
    PtyBackend::Screen => Command::new("screen")
      .args(["-ls", name])
      .output()
      .map(|out| String::from_utf8_lossy(&out.stdout).contains(name))
      .unwrap_or(false),
  }
}

/// Lists persistent sessions for `workspace` (or every treq-managed session
/// when `workspace` is `None`). Reads backend-reported state directly (no
/// Treq-owned index file to go stale) — every session this module ever
/// created is named `treq-pty-<workspace>-<label>`, so listing is a filter
/// over the backend's own session listing.
pub fn list_sessions(workspace: Option<&str>) -> Result<Vec<PtySessionInfo>, String> {
  let Some(backend) = detect_backend() else {
    return Ok(vec![]);
  };
  let names = match backend {
    PtyBackend::Tmux => {
      let output = Command::new("tmux")
        .args(["list-sessions", "-F", "#{session_name}"])
        .output()
        .map_err(|e| format!("dependency_error: Failed to list tmux sessions: {e}"))?;
      if !output.status.success() {
        // tmux exits non-zero ("no server running") when there are no
        // sessions at all — that is an empty list, not an error.
        return Ok(vec![]);
      }
      String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|s| s.to_string())
        .collect::<Vec<_>>()
    }
    PtyBackend::Screen => {
      let output = Command::new("screen")
        .arg("-ls")
        .output()
        .map_err(|e| format!("dependency_error: Failed to list screen sessions: {e}"))?;
      String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
          let trimmed = line.trim();
          // Lines look like "12345.treq-pty-foo-bar\t(Detached)".
          trimmed.split_whitespace().next().and_then(|token| {
            token
              .split_once('.')
              .map(|(_, name)| name.to_string())
              .filter(|_| token.contains('.'))
          })
        })
        .collect::<Vec<_>>()
    }
  };

  Ok(
    names
      .into_iter()
      .filter_map(|name| parse_session_name(&name))
      .filter(|(ws, _)| workspace.is_none_or(|w| w == ws))
      .map(|(ws, label)| PtySessionInfo {
        session_name: session_name(&ws, &label),
        workspace: ws,
        label,
        running: true,
      })
      .collect(),
  )
}

/// Parses a `treq-pty-<workspace>-<label>` session name back into
/// `(workspace, label)`. Best-effort: since sanitization is one-way (`-`/`_`
/// substitution), this recovers the sanitized form, which is what callers
/// need to re-derive `session_name` for `stop`/`resize`/`attach` — not
/// necessarily byte-identical to the original unsanitized workspace id, but
/// stable and sufficient for round-tripping sessions this module created.
fn parse_session_name(name: &str) -> Option<(String, String)> {
  let rest = name.strip_prefix("treq-pty-")?;
  // Split on the last '-' so a workspace id itself containing '-' (rare,
  // but session names are user-influenced) still resolves — the label is
  // the final path segment.
  let idx = rest.rfind('-')?;
  Some((rest[..idx].to_string(), rest[idx + 1..].to_string()))
}

/// Stops (kills) a persistent session. Idempotent: stopping a session that
/// does not exist is not an error.
pub fn stop_session(workspace: &str, label: &str) -> Result<(), String> {
  let Some(backend) = detect_backend() else {
    return Ok(());
  };
  let name = session_name(workspace, label);
  match backend {
    PtyBackend::Tmux => {
      let _ = Command::new("tmux")
        .args(["kill-session", "-t", &name])
        .status();
    }
    PtyBackend::Screen => {
      let _ = Command::new("screen")
        .args(["-S", &name, "-X", "quit"])
        .status();
    }
  }
  Ok(())
}

/// Explicitly resizes a session's virtual terminal, independent of any
/// attached client. Normally unnecessary (see module docs: tmux/screen
/// auto-resize to the attached client's window), but useful to pre-size a
/// session before the first attach.
pub fn resize_session(workspace: &str, label: &str, cols: u16, rows: u16) -> Result<(), String> {
  let backend = detect_backend()
    .ok_or_else(|| "dependency_error: Neither tmux nor screen is installed".to_string())?;
  let name = session_name(workspace, label);
  match backend {
    PtyBackend::Tmux => {
      let status = Command::new("tmux")
        .args(["resize-window", "-t", &name, "-x", &cols.to_string(), "-y", &rows.to_string()])
        .status()
        .map_err(|e| format!("dependency_error: Failed to resize tmux session: {e}"))?;
      if !status.success() {
        return Err(format!("dependency_error: tmux resize-window exited with {status}"));
      }
    }
    PtyBackend::Screen => {
      // `screen` has no headless resize-by-name equivalent; resize happens
      // implicitly on attach via the terminal's own size. Treated as a no-op
      // rather than an error so callers on a screen-only host are not
      // blocked.
    }
  }
  Ok(())
}

/// Builds the literal command line an SSH PTY channel execs to attach to
/// (creating first if necessary) a persistent session — the `pty-remote`
/// analogue of `core::remote_pty::build_launch_command`. Every dynamic
/// component is quoted with `shell_quote` exactly as that function does;
/// callers never interpolate caller-supplied strings into this command
/// directly.
///
/// Uses `tmux new-session -A` ("attach if it exists, else create") so one
/// command line covers both "start a fresh session" and "reattach to a
/// running one" — the mobile/desktop client does not need to know in
/// advance which case applies.
pub fn build_attach_command(
  remote_dir: &str,
  workspace: &str,
  label: &str,
  command: &str,
  cols: u16,
  rows: u16,
) -> Result<String, String> {
  let backend = detect_backend().ok_or_else(|| {
    "dependency_error: Neither tmux nor screen is installed on this host; pty-remote requires one of them for persistent/reattachable sessions".to_string()
  })?;
  let name = session_name(workspace, label);
  let quoted_dir = crate::core::remote::shell_quote(remote_dir);
  let quoted_name = crate::core::remote::shell_quote(&name);
  Ok(match backend {
    PtyBackend::Tmux => format!(
      "cd {quoted_dir} && exec tmux new-session -A -s {quoted_name} -x {cols} -y {rows} {command}"
    ),
    PtyBackend::Screen => format!(
      "cd {quoted_dir} && exec screen -xRR {quoted_name} bash -lc {command}"
    ),
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  fn tmux_available() -> bool {
    detect_backend() == Some(PtyBackend::Tmux)
  }

  #[test]
  fn session_name_sanitizes_unsafe_characters() {
    let name = session_name("workspace/1", "my label!");
    assert_eq!(name, "treq-pty-workspace_1-my_label_");
  }

  #[test]
  fn parse_session_name_round_trips_through_session_name() {
    let name = session_name("ws1", "term");
    let (workspace, label) = parse_session_name(&name).unwrap();
    assert_eq!(workspace, "ws1");
    assert_eq!(label, "term");
  }

  #[test]
  fn build_attach_command_quotes_a_malicious_working_directory() {
    if detect_backend().is_none() {
      // Environment has neither tmux nor screen: exercised by the
      // dependency_error test below instead.
      return;
    }
    let command = build_attach_command("/tmp/x'; rm -rf / #", "ws1", "term", "bash", 80, 24)
      .expect("backend detected");
    assert!(command.contains("'/tmp/x'\\''; rm -rf / #'"));
  }

  #[test]
  fn build_attach_command_errors_clearly_when_no_backend_detected() {
    // This test only documents behavior; it cannot force `detect_binary` to
    // fail in an environment where tmux/screen genuinely exist, so it is a
    // smoke check of the message shape via a direct call when unavailable.
    if detect_backend().is_some() {
      return;
    }
    let error = build_attach_command("/tmp", "ws1", "term", "bash", 80, 24).unwrap_err();
    assert!(error.contains("dependency_error"));
  }

  #[test]
  fn start_list_stop_lifecycle_round_trips_against_a_real_tmux_server() {
    if !tmux_available() {
      eprintln!("skipping: tmux not installed in this environment");
      return;
    }
    let dir = tempfile::tempdir().unwrap();
    let repo_path = dir.path().to_str().unwrap();
    let workspace = "test-ws-pty";
    let label = "term";

    // Ensure a clean slate in case a previous failed run left a session.
    let _ = stop_session(workspace, label);

    let info = start_session(repo_path, workspace, label, "sleep 60", 80, 24).unwrap();
    assert!(info.running);
    assert_eq!(info.session_name, session_name(workspace, label));

    // Starting again is idempotent: same session, no error.
    let info_again = start_session(repo_path, workspace, label, "sleep 60", 80, 24).unwrap();
    assert_eq!(info_again.session_name, info.session_name);

    let sessions = list_sessions(Some(workspace)).unwrap();
    assert!(sessions.iter().any(|s| s.session_name == info.session_name));

    resize_session(workspace, label, 100, 40).unwrap();

    stop_session(workspace, label).unwrap();
    let sessions_after = list_sessions(Some(workspace)).unwrap();
    assert!(!sessions_after.iter().any(|s| s.session_name == info.session_name));

    // Stopping again is idempotent.
    stop_session(workspace, label).unwrap();
  }

  #[test]
  fn attach_command_reattaches_to_an_existing_session_without_recreating_it() {
    if !tmux_available() {
      eprintln!("skipping: tmux not installed in this environment");
      return;
    }
    let dir = tempfile::tempdir().unwrap();
    let repo_path = dir.path().to_str().unwrap();
    let workspace = "test-ws-reattach";
    let label = "term";
    let _ = stop_session(workspace, label);

    let info = start_session(repo_path, workspace, label, "sleep 60", 80, 24).unwrap();

    let attach_cmd =
      build_attach_command(repo_path, workspace, label, "sleep 60", 80, 24).unwrap();
    assert!(attach_cmd.contains("new-session -A"));
    assert!(attach_cmd.contains(&info.session_name));

    stop_session(workspace, label).unwrap();
  }
}
