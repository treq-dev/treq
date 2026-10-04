use crate::core::feature_preview::PreviewFeature;
use crate::google::{
  DriveFile, GoogleConnectionStatus, GoogleSource, GoogleTask, GoogleTaskList, TaskInput,
};
use crate::AppState;
use tauri::State;

/// Checks the preview flag and resolves the Pro proxy session.
fn source_for(state: &State<'_, AppState>) -> Result<GoogleSource, String> {
  crate::commands::feature_preview::require(state, PreviewFeature::GoogleWorkspace)?;
  crate::google::resolve_source()
}

#[tauri::command]
pub async fn google_connection_status(
  state: State<'_, AppState>,
) -> Result<GoogleConnectionStatus, String> {
  crate::commands::feature_preview::require(&state, PreviewFeature::GoogleWorkspace)?;
  Ok(crate::google::connection_status(crate::google::resolve_source()).await)
}

/// Opens, or creates, the workspace for a Google Task and links it.
#[tauri::command]
pub async fn google_open_or_create_workspace_from_task(
  state: State<'_, AppState>,
  repo_path: String,
  list_id: String,
  task_id: String,
) -> Result<crate::core::google_tasks::GoogleTaskKickoffResult, String> {
  let source = source_for(&state)?;
  crate::core::google_tasks::open_or_create_workspace_from_task(
    &source, &repo_path, &list_id, &task_id,
  )
  .await
}

/// Links a Google Task to a workspace, replacing any earlier link.
#[tauri::command]
pub async fn google_link_task_to_workspace(
  state: State<'_, AppState>,
  repo_path: String,
  workspace_id: i64,
  list_id: String,
  task_id: String,
) -> Result<(), String> {
  let source = source_for(&state)?;
  crate::core::google_tasks::link_task_to_workspace(
    &source,
    &repo_path,
    workspace_id,
    &list_id,
    &task_id,
  )
  .await
}

#[tauri::command]
pub async fn google_unlink_task(
  state: State<'_, AppState>,
  repo_path: String,
  workspace_id: i64,
) -> Result<(), String> {
  crate::commands::feature_preview::require(&state, PreviewFeature::GoogleWorkspace)?;
  crate::core::merge_google_task_metadata(&repo_path, workspace_id, None).map(|_| ())
}

/// The current review export of a Drive file for this repo.
#[tauri::command]
pub async fn google_read_doc_export(
  state: State<'_, AppState>,
  repo_path: String,
  file_id: String,
) -> Result<crate::core::google_review::DocExport, String> {
  crate::commands::feature_preview::require(&state, PreviewFeature::GoogleWorkspace)?;
  crate::core::google_review::read_doc_export(&repo_path, &file_id)
}

#[tauri::command]
pub async fn google_list_task_lists(
  state: State<'_, AppState>,
) -> Result<Vec<GoogleTaskList>, String> {
  crate::google::list_task_lists(&source_for(&state)?).await
}

#[tauri::command]
pub async fn google_create_task_list(
  state: State<'_, AppState>,
  title: String,
) -> Result<GoogleTaskList, String> {
  crate::google::create_task_list(&source_for(&state)?, &title).await
}

#[tauri::command]
pub async fn google_list_tasks(
  state: State<'_, AppState>,
  list_id: String,
) -> Result<Vec<GoogleTask>, String> {
  crate::google::list_tasks(&source_for(&state)?, &list_id).await
}

#[tauri::command]
pub async fn google_create_task(
  state: State<'_, AppState>,
  list_id: String,
  input: TaskInput,
) -> Result<GoogleTask, String> {
  crate::google::create_task(&source_for(&state)?, &list_id, &input).await
}

#[tauri::command]
pub async fn google_update_task(
  state: State<'_, AppState>,
  list_id: String,
  task_id: String,
  input: TaskInput,
) -> Result<GoogleTask, String> {
  crate::google::update_task(&source_for(&state)?, &list_id, &task_id, &input).await
}

#[tauri::command]
pub async fn google_delete_task(
  state: State<'_, AppState>,
  list_id: String,
  task_id: String,
) -> Result<(), String> {
  crate::google::delete_task(&source_for(&state)?, &list_id, &task_id).await
}

#[tauri::command]
pub async fn google_move_task(
  state: State<'_, AppState>,
  list_id: String,
  task_id: String,
  destination_list_id: Option<String>,
  parent: Option<String>,
  previous_task_id: Option<String>,
) -> Result<crate::google::MoveTaskResult, String> {
  crate::google::move_task(
    &source_for(&state)?,
    &list_id,
    &task_id,
    destination_list_id.as_deref(),
    parent.as_deref(),
    previous_task_id.as_deref(),
  )
  .await
}

#[tauri::command]
pub async fn google_list_drive_files(
  state: State<'_, AppState>,
  search: Option<String>,
  docs_only: bool,
) -> Result<Vec<DriveFile>, String> {
  crate::google::list_drive_files(&source_for(&state)?, search.as_deref(), docs_only).await
}

/// Exports a Drive file into `~/Documents/treq/exports/<repo key>/<id>/` for the review agent.
#[tauri::command]
pub async fn google_prepare_doc_review(
  state: State<'_, AppState>,
  repo_path: String,
  file_id: String,
) -> Result<crate::core::google_review::PreparedDocReview, String> {
  crate::core::google_review::prepare_doc_review(&source_for(&state)?, &repo_path, &file_id).await
}

/// Deletes the unposted findings for a file; call after a new review launched.
#[tauri::command]
pub async fn google_discard_unposted_findings(
  state: State<'_, AppState>,
  repo_path: String,
  file_id: String,
  finding_ids: Vec<String>,
) -> Result<(), String> {
  crate::commands::feature_preview::require(&state, PreviewFeature::GoogleWorkspace)?;
  crate::core::google_review::discard_unposted_findings(&repo_path, &file_id, &finding_ids)
}

/// All open (unposted) Google Doc findings in the repo.
#[tauri::command]
pub async fn google_list_doc_findings(
  state: State<'_, AppState>,
  repo_path: String,
) -> Result<Vec<crate::local_db::AgentReviewComment>, String> {
  crate::commands::feature_preview::require(&state, PreviewFeature::GoogleWorkspace)?;
  crate::core::google_review::list_doc_findings(&repo_path)
}

/// Posts the agent's open comments to the Drive file and resolves them.
#[tauri::command]
pub async fn google_post_review_comments(
  state: State<'_, AppState>,
  repo_path: String,
  file_id: String,
) -> Result<crate::core::google_review::PostCommentsResult, String> {
  crate::core::google_review::post_review_comments(&source_for(&state)?, &repo_path, &file_id).await
}
