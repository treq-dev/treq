use crate::core::feature_preview::PreviewFeature;
use crate::google::{
  DriveFile, GoogleConnectionStatus, GoogleSource, GoogleTask, GoogleTaskList, TaskInput,
};
use crate::lock_ext::LockExt;
use crate::AppState;
use tauri::State;

/// Checks the preview flag and resolves credentials. The db lock is released
/// before returning so callers can await network requests.
fn source_for(state: &State<'_, AppState>) -> Result<GoogleSource, String> {
  crate::commands::feature_preview::require(state, PreviewFeature::GoogleWorkspace)?;
  resolve(state)
}

fn resolve(state: &State<'_, AppState>) -> Result<GoogleSource, String> {
  let db = state.db.lock_or_recover();
  crate::google::resolve_source(&db, crate::core::resolve_app_db_path(""))
}

#[tauri::command]
pub async fn google_connection_status(
  state: State<'_, AppState>,
) -> Result<GoogleConnectionStatus, String> {
  crate::commands::feature_preview::require(&state, PreviewFeature::GoogleWorkspace)?;
  Ok(crate::google::connection_status(resolve(&state)).await)
}

/// Starts the loopback OAuth flow and returns the URL to open.
#[tauri::command]
pub async fn google_oauth_begin(
  state: State<'_, AppState>,
  client_id: String,
  client_secret: Option<String>,
) -> Result<String, String> {
  crate::commands::feature_preview::require(&state, PreviewFeature::GoogleWorkspace)?;
  let client_id = client_id.trim().to_string();
  if client_id.is_empty() {
    return Err("Enter a Google OAuth client ID first".to_string());
  }
  crate::google::begin_local_oauth(client_id, client_secret).await
}

/// Cancels a sign-in begun with `google_oauth_begin`; a waiting
/// `google_oauth_complete` returns "Google sign-in was cancelled".
#[tauri::command]
pub async fn google_oauth_cancel(state: State<'_, AppState>) -> Result<(), String> {
  crate::commands::feature_preview::require(&state, PreviewFeature::GoogleWorkspace)?;
  crate::google::cancel_local_oauth().await;
  Ok(())
}

/// Waits for the browser redirect and stores the client and tokens.
#[tauri::command]
pub async fn google_oauth_complete(state: State<'_, AppState>) -> Result<(), String> {
  crate::commands::feature_preview::require(&state, PreviewFeature::GoogleWorkspace)?;
  let (tokens, client_id, client_secret) = crate::google::complete_local_oauth().await?;
  let db = state.db.lock_or_recover();
  crate::google::store_local_grant(&db, &tokens, &client_id, client_secret.as_deref())
}

/// Forgets the locally stored tokens. Not gated, so turning the preview off
/// never strands a grant. Pro grants are removed by `disconnect-google`.
#[tauri::command]
pub fn google_disconnect_local(state: State<'_, AppState>) -> Result<(), String> {
  let db = state.db.lock_or_recover();
  crate::google::disconnect_local(&db)
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
) -> Result<GoogleTask, String> {
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

/// Posts the agent's open comments to the Drive file and resolves them.
#[tauri::command]
pub async fn google_post_review_comments(
  state: State<'_, AppState>,
  repo_path: String,
  file_id: String,
) -> Result<crate::core::google_review::PostCommentsResult, String> {
  crate::core::google_review::post_review_comments(&source_for(&state)?, &repo_path, &file_id).await
}
