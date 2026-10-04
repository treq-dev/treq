//! Linking Google Tasks to workspaces: kick off a workspace from a task, or
//! link one by hand. `pr_status` completes the task when the PR merges.

use serde::Serialize;

use crate::google::{get_task, GoogleSource, GoogleTask};

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct GoogleTaskKickoffResult {
  pub workspace_id: i64,
  pub created: bool,
}

/// `gtask-<first 8 id chars>-<title slug>`. Task ids are base64-ish, so
/// only alphanumerics are kept and lowercased for a tidy branch name.
pub fn task_branch_name(task: &GoogleTask) -> String {
  let short: String = task
    .id
    .chars()
    .filter(char::is_ascii_alphanumeric)
    .take(8)
    .collect::<String>()
    .to_ascii_lowercase();
  let prefix = if short.is_empty() {
    "gtask".to_string()
  } else {
    format!("gtask-{short}")
  };
  crate::tracker::branch_name(&prefix, &task.title)
}

fn link(task: &GoogleTask) -> super::GoogleTaskLink<'_> {
  super::GoogleTaskLink {
    list_id: &task.list_id,
    task_id: &task.id,
    title: &task.title,
    url: task.web_link.as_deref(),
  }
}

pub async fn open_or_create_workspace_from_task(
  source: &GoogleSource,
  repo_path: &str,
  list_id: &str,
  task_id: &str,
) -> Result<GoogleTaskKickoffResult, String> {
  let task = get_task(source, list_id, task_id).await?;
  let repo_path = repo_path.to_string();
  tauri::async_runtime::spawn_blocking(move || {
    let base_branch = super::get_repo_default_branch(&repo_path)
      .map_err(|e| format!("Failed to get repo default branch: {e}"))?;
    let (ws, created) = super::open_or_create_workspace_from_issue(
      &repo_path,
      &task_branch_name(&task),
      &base_branch,
      &task.title,
      task.notes.as_deref(),
    )
    .map_err(|e| format!("Failed to create workspace for Google Task: {e}"))?;
    // Re-opening a workspace already linked to this task keeps its
    // completed flag; anything else (re)links it.
    let meta = super::parse_workspace_metadata(ws.metadata.as_deref());
    if meta.google_task_id.as_deref() != Some(task.id.as_str()) {
      super::merge_google_task_metadata(&repo_path, ws.id, Some(&link(&task)))?;
    }
    Ok(GoogleTaskKickoffResult {
      workspace_id: ws.id,
      created,
    })
  })
  .await
  .map_err(|e| format!("Failed to join workspace creation task: {e}"))?
}

pub async fn link_task_to_workspace(
  source: &GoogleSource,
  repo_path: &str,
  workspace_id: i64,
  list_id: &str,
  task_id: &str,
) -> Result<(), String> {
  let task = get_task(source, list_id, task_id).await?;
  super::merge_google_task_metadata(repo_path, workspace_id, Some(&link(&task))).map(|_| ())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn task(id: &str, title: &str) -> GoogleTask {
    GoogleTask {
      id: id.into(),
      list_id: "L1".into(),
      title: title.into(),
      notes: None,
      status: "needsAction".into(),
      due: None,
      parent: None,
      position: String::new(),
      web_link: None,
    }
  }

  #[test]
  fn task_branch_name_uses_short_id_and_slug() {
    assert_eq!(
      task_branch_name(&task("MTA4NjE-xyz_Q", "Fix the login bug")),
      "gtask-mta4njex-fix-the-login-bug"
    );
  }

  #[test]
  fn task_branch_name_without_title_is_prefix_only() {
    assert_eq!(task_branch_name(&task("abc", "")), "gtask-abc");
    assert_eq!(task_branch_name(&task("--", "")), "gtask");
  }
}
