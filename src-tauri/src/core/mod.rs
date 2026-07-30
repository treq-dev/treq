pub mod app;
pub mod changes;
pub mod commits;
pub mod remote;
pub mod repo;
pub mod workspaces;
pub use app::*;
pub use changes::*;
pub use commits::*;
pub use repo::*;
use std::path::{Path, PathBuf};
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
    resolve_conflict_marker_style_from_db(&db.lock().unwrap())
}

pub fn resolve_app_db_path(repo_path: &str) -> PathBuf {
    if let Ok(explicit_db_path) = std::env::var("TREQ_APP_DB_PATH") {
        let trimmed = explicit_db_path.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    if let Ok(app_data_dir) = std::env::var("TREQ_APP_DATA_DIR") {
        let trimmed = app_data_dir.trim();
        if !trimmed.is_empty() {
            return Path::new(trimmed).join("treq.db");
        }
    }

    Path::new(repo_path).join(".treq").join("treq.db")
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
        assert_eq!(resolved.to_string_lossy(), "/tmp/app-data/treq.db");

        std::env::remove_var("TREQ_APP_DATA_DIR");
    }
}
