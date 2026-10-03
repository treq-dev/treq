pub mod agent_chat;
pub mod agent_cli;
pub mod agent_supervisor;
pub mod app;
pub mod app_setup_script;
pub mod auto_update;
pub mod browser_review;
pub mod changes;
pub mod checks;
pub mod checks_logs;
pub mod commits;
pub mod feature_preview;
pub mod files;
pub mod github_issues;
pub mod idempotency_store;
pub mod pty_remote_supervisor;
pub mod remote;
pub mod remote_control_plane;
pub mod remote_device_key;
pub mod remote_local_keys;
pub mod remote_provider;
pub mod remote_provider_sprites;
pub mod remote_pty;
pub mod remote_ssh_config;
pub mod remote_ssh_transport;
pub mod remote_ssh_ws_stream;
pub mod repo;
pub mod resolve;
pub mod sessions;
pub mod shell_step;
pub mod skills;
pub mod stash;
pub mod submodules;
pub mod workspaces;
use crate::lock_ext::LockExt;
pub use agent_chat::*;
pub use agent_cli::*;
pub use app::*;
pub use auto_update::*;
pub use browser_review::*;
pub use changes::*;
pub use checks::*;
pub use checks_logs::*;
pub use commits::*;
pub use files::*;
pub use repo::*;
pub use resolve::*;
pub use skills::*;
pub use stash::*;
use std::path::{Path, PathBuf};
pub use submodules::*;
pub use workspaces::*;

pub const DEFAULT_CONFLICT_MARKER_STYLE: &str = "git";

pub fn resolve_conflict_marker_style_from_db(db: &crate::db::Database) -> String {
  db.get_setting("conflict_marker_style")
    .ok()
    .flatten()
    .and_then(|value| {
      let trimmed = value.trim();
      if trimmed.is_empty() {
        None
      } else {
        Some(trimmed.to_string())
      }
    })
    .unwrap_or_else(|| DEFAULT_CONFLICT_MARKER_STYLE.to_string())
}

pub fn resolve_conflict_marker_style(db: &std::sync::Mutex<crate::db::Database>) -> String {
  resolve_conflict_marker_style_from_db(&db.lock_or_recover())
}

/// The app DB path from `TREQ_APP_DB_PATH`, else `treq.db` in
/// `TREQ_APP_DATA_DIR`. Blank values count as unset.
pub fn app_db_path_from_env() -> Option<PathBuf> {
  let var = |name| {
    std::env::var(name)
      .ok()
      .map(|value| value.trim().to_string())
      .filter(|value| !value.is_empty())
  };
  var("TREQ_APP_DB_PATH")
    .map(PathBuf::from)
    .or_else(|| var("TREQ_APP_DATA_DIR").map(|dir| Path::new(&dir).join("treq.db")))
}

pub fn resolve_app_db_path(repo_path: &str) -> PathBuf {
  app_db_path_from_env().unwrap_or_else(|| Path::new(repo_path).join(".treq").join("treq.db"))
}

#[cfg(test)]
mod tests {
  use super::resolve_app_db_path;
  use std::sync::{Mutex, OnceLock};

  fn env_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
  }

  #[test]
  fn resolve_app_db_path_prefers_explicit_db_path() {
    let _guard = env_lock().lock().unwrap();
    std::env::set_var("TREQ_APP_DB_PATH", "/tmp/explicit-treq.db");
    std::env::set_var("TREQ_APP_DATA_DIR", "/tmp/ignored-dir");

    let resolved = resolve_app_db_path("/repo/path");
    assert_eq!(resolved.to_string_lossy(), "/tmp/explicit-treq.db");

    std::env::remove_var("TREQ_APP_DB_PATH");
    std::env::remove_var("TREQ_APP_DATA_DIR");
  }

  #[test]
  fn resolve_app_db_path_falls_back_to_app_data_dir() {
    let _guard = env_lock().lock().unwrap();
    std::env::remove_var("TREQ_APP_DB_PATH");
    std::env::set_var("TREQ_APP_DATA_DIR", "/tmp/app-data");

    let resolved = resolve_app_db_path("/repo/path");
    let expected = std::path::Path::new("/tmp/app-data").join("treq.db");
    assert_eq!(resolved, expected);

    std::env::remove_var("TREQ_APP_DATA_DIR");
  }
}
