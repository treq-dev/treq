use crate::lock_ext::LockExt;
use crate::repo_config::RepoConfig;
use crate::AppState;
use tauri::State;

/// Parse `.treq/config.yaml` and write every field it sets into the repo's
/// settings store, so `get_repo_setting` (and every UI already reading from
/// it) reflects the config file without any extra logic elsewhere. Returns
/// the parsed config so the frontend knows which fields are YAML-managed.
#[tauri::command]
pub fn load_repo_yaml_config(
  state: State<AppState>,
  repo_path: String,
) -> Result<RepoConfig, String> {
  let config = crate::repo_config::parse_config(&repo_path)?;
  let db = state.db.lock_or_recover();
  crate::repo_config::sync_to_settings(&db, &repo_path, &config)?;
  Ok(config)
}
