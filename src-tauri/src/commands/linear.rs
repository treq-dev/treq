use crate::linear::{
  LinearClientSource, LinearComment, LinearDocument, LinearIssue, LinearProject, LinearTeam,
  LinearUser,
};
use crate::lock_ext::LockExt;
use crate::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;

#[derive(Serialize, Deserialize, Clone)]
pub struct LinearKickoffResult {
  pub issue_id: String,
  pub workspace_id: i64,
  pub created: bool,
}

#[tauri::command]
pub async fn linear_list_teams(
  state: State<'_, AppState>,
  repo_path: String,
) -> Result<Vec<LinearTeam>, String> {
  crate::commands::feature_preview::require(
    &state,
    crate::core::feature_preview::PreviewFeature::LinearIntegration,
  )?;
  let client_source = {
    let db = state.db.lock_or_recover();
    crate::linear::resolve_linear_client(&repo_path, &db)?
  };

  match client_source {
    LinearClientSource::ApiKey(api_key) => crate::linear::linear_list_teams_impl(&api_key).await,
    LinearClientSource::ProxyToken => {
      Err("Linear integration not yet configured (OAuth proxy not ready)".to_string())
    }
  }
}

#[tauri::command]
pub async fn linear_list_issues(
  state: State<'_, AppState>,
  repo_path: String,
  team_filter: Option<String>,
) -> Result<Vec<LinearIssue>, String> {
  crate::commands::feature_preview::require(
    &state,
    crate::core::feature_preview::PreviewFeature::LinearIntegration,
  )?;
  let client_source = {
    let db = state.db.lock_or_recover();
    crate::linear::resolve_linear_client(&repo_path, &db)?
  };

  match client_source {
    LinearClientSource::ApiKey(api_key) => {
      crate::linear::linear_list_issues_impl(&api_key, team_filter.as_deref()).await
    }
    LinearClientSource::ProxyToken => {
      Err("Linear integration not yet configured (OAuth proxy not ready)".to_string())
    }
  }
}

#[tauri::command]
pub async fn linear_open_or_create_workspace_from_issue(
  state: State<'_, AppState>,
  repo_path: String,
  issue_id: String,
  include_subissues: bool,
) -> Result<Vec<LinearKickoffResult>, String> {
  crate::commands::feature_preview::require(
    &state,
    crate::core::feature_preview::PreviewFeature::LinearIntegration,
  )?;
  let client_source = {
    let db = state.db.lock_or_recover();
    crate::linear::resolve_linear_client(&repo_path, &db)?
  };

  match client_source {
    LinearClientSource::ApiKey(api_key) => {
      let issue = crate::linear::linear_get_issue_impl(&api_key, &issue_id).await?;
      let mut results = vec![];
      results.push(open_or_create_workspace_from_linear_issue(&repo_path, &issue).await?);

      if include_subissues {
        for sub_id in &issue.sub_issue_ids {
          match crate::linear::linear_get_issue_impl(&api_key, sub_id).await {
            Ok(sub_issue) => {
              match open_or_create_workspace_from_linear_issue(&repo_path, &sub_issue).await {
                Ok(result) => {
                  if result.created {
                    let db = state.db.lock_or_recover();
                    record_linear_workspace_parent(
                      &db,
                      &repo_path,
                      result.workspace_id,
                      &issue_id,
                    )?;
                  }
                  results.push(result);
                }
                Err(e) => log::warn!("Failed to kickoff sub-issue {sub_id}: {e}"),
              }
            }
            Err(e) => log::warn!("Failed to fetch sub-issue {sub_id}: {e}"),
          }
        }
      }

      Ok(results)
    }
    LinearClientSource::ProxyToken => {
      Err("Linear integration not yet configured (OAuth proxy not ready)".to_string())
    }
  }
}

// Holding a mutex guard across an .await would poison the tauri command's
// Send bound, so workspace creation stays lock-free; callers lock briefly
// afterward, only for this synchronous bookkeeping write.
pub fn record_linear_workspace_parent(
  db: &crate::db::Database,
  repo_path: &str,
  workspace_id: i64,
  parent_issue_id: &str,
) -> Result<(), String> {
  let mut current: HashMap<String, String> = db
    .get_repo_setting(repo_path, "linear_workspace_parents")
    .ok()
    .flatten()
    .and_then(|s| serde_json::from_str(&s).ok())
    .unwrap_or_default();
  current.insert(workspace_id.to_string(), parent_issue_id.to_string());
  let json = serde_json::to_string(&current)
    .map_err(|e| format!("Failed to serialize workspace parents: {e}"))?;
  db.set_repo_setting(repo_path, "linear_workspace_parents", &json)
    .map_err(|e| format!("Failed to save workspace parents: {e}"))
}

pub async fn open_or_create_workspace_from_linear_issue(
  repo_path: &str,
  issue: &LinearIssue,
) -> Result<LinearKickoffResult, String> {
  let repo_path_owned = repo_path.to_string();
  let branch_name = issue.branch_name.clone();
  let title = issue.title.clone();
  let description = issue.description.clone();
  let identifier = issue.identifier.clone();
  let issue_id = issue.id.clone();
  let issue_key = issue.identifier.clone();
  let issue_url = issue.url.clone();
  let issue_title = issue.title.clone();

  let (workspace, created) = tauri::async_runtime::spawn_blocking(move || {
    let base_branch = crate::core::get_repo_default_branch(&repo_path_owned)
      .map_err(|e| format!("Failed to get repo default branch: {e}"))?;

    let (ws, ws_created) = crate::core::open_or_create_workspace_from_linear_issue(
      &repo_path_owned,
      &branch_name,
      &base_branch,
      &title,
      description.as_deref(),
    )
    .map_err(|e| {
      format!(
        "Failed to create workspace for Linear issue {}: {e}",
        identifier
      )
    })?;

    if let Err(e) = crate::core::merge_linear_issue_metadata(
      &repo_path_owned,
      ws.id,
      &issue_key,
      &issue_url,
      &issue_title,
    ) {
      log::warn!(
        "Failed to set Linear issue metadata for workspace {}: {}",
        ws.id,
        e
      );
    }

    Ok::<_, String>((ws, ws_created))
  })
  .await
  .map_err(|e| format!("Failed to join workspace creation task: {e}"))?
  .map(|ws| (ws.0, ws.1))?;

  Ok(LinearKickoffResult {
    issue_id,
    workspace_id: workspace.id,
    created,
  })
}

#[tauri::command]
pub async fn linear_get_viewer(
  state: State<'_, AppState>,
  repo_path: String,
) -> Result<LinearUser, String> {
  crate::commands::feature_preview::require(
    &state,
    crate::core::feature_preview::PreviewFeature::LinearIntegration,
  )?;
  let client_source = {
    let db = state.db.lock_or_recover();
    crate::linear::resolve_linear_client(&repo_path, &db)?
  };

  match client_source {
    LinearClientSource::ApiKey(api_key) => crate::linear::linear_get_viewer_impl(&api_key).await,
    LinearClientSource::ProxyToken => {
      Err("Linear integration not yet configured (OAuth proxy not ready)".to_string())
    }
  }
}

#[tauri::command]
pub async fn linear_list_projects(
  state: State<'_, AppState>,
  repo_path: String,
) -> Result<Vec<LinearProject>, String> {
  crate::commands::feature_preview::require(
    &state,
    crate::core::feature_preview::PreviewFeature::LinearIntegration,
  )?;
  let client_source = {
    let db = state.db.lock_or_recover();
    crate::linear::resolve_linear_client(&repo_path, &db)?
  };

  match client_source {
    LinearClientSource::ApiKey(api_key) => crate::linear::linear_list_projects_impl(&api_key).await,
    LinearClientSource::ProxyToken => {
      Err("Linear integration not yet configured (OAuth proxy not ready)".to_string())
    }
  }
}

#[tauri::command]
pub async fn linear_list_project_documents(
  state: State<'_, AppState>,
  repo_path: String,
  project_id: String,
) -> Result<Vec<LinearDocument>, String> {
  crate::commands::feature_preview::require(
    &state,
    crate::core::feature_preview::PreviewFeature::LinearIntegration,
  )?;
  let client_source = {
    let db = state.db.lock_or_recover();
    crate::linear::resolve_linear_client(&repo_path, &db)?
  };

  match client_source {
    LinearClientSource::ApiKey(api_key) => {
      crate::linear::linear_list_project_documents_impl(&api_key, &project_id).await
    }
    LinearClientSource::ProxyToken => {
      Err("Linear integration not yet configured (OAuth proxy not ready)".to_string())
    }
  }
}

#[tauri::command]
pub async fn linear_list_issue_comments(
  state: State<'_, AppState>,
  repo_path: String,
  issue_id: String,
) -> Result<Vec<LinearComment>, String> {
  crate::commands::feature_preview::require(
    &state,
    crate::core::feature_preview::PreviewFeature::LinearIntegration,
  )?;
  let client_source = {
    let db = state.db.lock_or_recover();
    crate::linear::resolve_linear_client(&repo_path, &db)?
  };

  match client_source {
    LinearClientSource::ApiKey(api_key) => {
      crate::linear::linear_list_issue_comments_impl(&api_key, &issue_id).await
    }
    LinearClientSource::ProxyToken => {
      Err("Linear integration not yet configured (OAuth proxy not ready)".to_string())
    }
  }
}

#[tauri::command]
pub async fn linear_list_project_comments(
  state: State<'_, AppState>,
  repo_path: String,
  project_id: String,
) -> Result<Vec<LinearComment>, String> {
  crate::commands::feature_preview::require(
    &state,
    crate::core::feature_preview::PreviewFeature::LinearIntegration,
  )?;
  let client_source = {
    let db = state.db.lock_or_recover();
    crate::linear::resolve_linear_client(&repo_path, &db)?
  };

  match client_source {
    LinearClientSource::ApiKey(api_key) => {
      crate::linear::linear_list_project_comments_impl(&api_key, &project_id).await
    }
    LinearClientSource::ProxyToken => {
      Err("Linear integration not yet configured (OAuth proxy not ready)".to_string())
    }
  }
}

#[tauri::command]
pub async fn linear_list_document_comments(
  state: State<'_, AppState>,
  repo_path: String,
  document_id: String,
) -> Result<Vec<LinearComment>, String> {
  crate::commands::feature_preview::require(
    &state,
    crate::core::feature_preview::PreviewFeature::LinearIntegration,
  )?;
  let client_source = {
    let db = state.db.lock_or_recover();
    crate::linear::resolve_linear_client(&repo_path, &db)?
  };

  match client_source {
    LinearClientSource::ApiKey(api_key) => {
      crate::linear::linear_list_document_comments_impl(&api_key, &document_id).await
    }
    LinearClientSource::ProxyToken => {
      Err("Linear integration not yet configured (OAuth proxy not ready)".to_string())
    }
  }
}

#[tauri::command]
pub fn linear_start_auto_kickoff_polling(
  state: State<'_, AppState>,
  repo_path: String,
) -> Result<(), String> {
  crate::commands::feature_preview::require(
    &state,
    crate::core::feature_preview::PreviewFeature::LinearIntegration,
  )?;
  crate::linear::kickoff_poller().watch_repo(&repo_path);
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn kickoff_result_serializes_to_json() {
    let result = LinearKickoffResult {
      issue_id: "ENG-1".to_string(),
      workspace_id: 42,
      created: true,
    };
    let json = serde_json::to_string(&result).unwrap();
    assert!(json.contains("ENG-1"));
    assert!(json.contains("42"));
    assert!(json.contains("true"));
  }

  #[test]
  fn kickoff_result_deserializes_from_json() {
    let json = r#"{"issue_id":"ENG-2","workspace_id":99,"created":false}"#;
    let result: LinearKickoffResult = serde_json::from_str(json).unwrap();
    assert_eq!(result.issue_id, "ENG-2");
    assert_eq!(result.workspace_id, 99);
    assert!(!result.created);
  }
}
