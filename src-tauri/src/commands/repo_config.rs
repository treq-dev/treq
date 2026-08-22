use crate::repo_config::RepoConfig;

/// Read `.treq/config.yaml`, cache every field to the local DB, and return the parsed config.
#[tauri::command]
pub fn load_repo_yaml_config(repo_path: String) -> Result<RepoConfig, String> {
  crate::repo_config::load_and_cache(&repo_path)
}
