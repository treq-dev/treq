use crate::lock_ext::LockExt;
use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn mark_file_viewed(
  state: State<AppState>,
  workspace_path: String,
  file_path: String,
  content_hash: String,
) -> Result<(), String> {
  let db = state.db.lock_or_recover();
  db.mark_file_viewed(&workspace_path, &file_path, &content_hash)
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn unmark_file_viewed(
  state: State<AppState>,
  workspace_path: String,
  file_path: String,
) -> Result<(), String> {
  let db = state.db.lock_or_recover();
  db.unmark_file_viewed(&workspace_path, &file_path)
    .map_err(|e| e.to_string())
}
