use crate::lock_ext::LockExt;
use crate::tracker::{
  TrackerClient, TrackerContainer, TrackerItem, TrackerKickoffResult, TrackerProvider, TrackerUser,
};
use crate::AppState;
use tauri::State;

/// Checks the provider's preview flag and reads its credentials. The db lock
/// is released before returning so callers can await network requests.
fn client_for(
  state: &State<'_, AppState>,
  provider: TrackerProvider,
  repo_path: &str,
) -> Result<TrackerClient, String> {
  crate::commands::feature_preview::require(state, provider.feature())?;
  let db = state.db.lock_or_recover();
  crate::tracker::resolve_client(provider, repo_path, &db)
}

#[tauri::command]
pub async fn tracker_list_containers(
  state: State<'_, AppState>,
  provider: TrackerProvider,
  repo_path: String,
) -> Result<Vec<TrackerContainer>, String> {
  let client = client_for(&state, provider, &repo_path)?;
  client.list_containers().await
}

#[tauri::command]
pub async fn tracker_list_items(
  state: State<'_, AppState>,
  provider: TrackerProvider,
  repo_path: String,
  container_id: Option<String>,
) -> Result<Vec<TrackerItem>, String> {
  let client = client_for(&state, provider, &repo_path)?;
  client.list_items(container_id.as_deref()).await
}

#[tauri::command]
pub async fn tracker_get_viewer(
  state: State<'_, AppState>,
  provider: TrackerProvider,
  repo_path: String,
) -> Result<TrackerUser, String> {
  let client = client_for(&state, provider, &repo_path)?;
  client.get_viewer().await
}

#[tauri::command]
pub async fn tracker_open_or_create_workspace_from_item(
  state: State<'_, AppState>,
  provider: TrackerProvider,
  repo_path: String,
  item_id: String,
) -> Result<TrackerKickoffResult, String> {
  let client = client_for(&state, provider, &repo_path)?;
  crate::tracker::kickoff_item(&client, provider, &repo_path, &item_id).await
}

#[tauri::command]
pub fn tracker_start_auto_kickoff_polling(
  state: State<'_, AppState>,
  provider: TrackerProvider,
  repo_path: String,
) -> Result<(), String> {
  crate::commands::feature_preview::require(&state, provider.feature())?;
  crate::tracker::kickoff_poller(provider).watch_repo(&repo_path);
  Ok(())
}
