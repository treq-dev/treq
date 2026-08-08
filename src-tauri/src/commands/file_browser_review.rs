use crate::local_db;

#[tauri::command]
pub fn load_file_browser_review(
    repo_path: String,
    workspace_id: i64,
) -> Result<Option<local_db::FileBrowserPendingReview>, String> {
    local_db::get_file_browser_review(&repo_path, workspace_id)
}

#[tauri::command]
pub fn save_file_browser_review(
    repo_path: String,
    workspace_id: i64,
    comments: String,
    summary_text: Option<String>,
) -> Result<i64, String> {
    local_db::save_file_browser_review(&repo_path, workspace_id, &comments, summary_text.as_deref())
}

#[tauri::command]
pub fn clear_file_browser_review(repo_path: String, workspace_id: i64) -> Result<(), String> {
    local_db::clear_file_browser_review(&repo_path, workspace_id)
}
