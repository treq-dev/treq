use crate::core;
use crate::jj;
use crate::AppState;
use std::time::Instant;
use tauri::State;

// JJ Workspace commands

#[tauri::command]
pub fn get_workspace_file_hunks(
    state: State<AppState>,
    repo_path: String,
    workspace_id: Option<i64>,
    file_path: String,
) -> Result<Vec<jj::JjDiffHunk>, String> {
    let conflict_style = core::resolve_conflict_marker_style(&state.db);
    crate::core::list_file_hunks(&repo_path, workspace_id, &file_path, &conflict_style)
}

#[tauri::command]
pub fn get_workspace_file_lines(
    repo_path: String,
    workspace_id: Option<i64>,
    file_path: String,
    from_parent: bool,
    start_line: usize,
    end_line: usize,
) -> Result<jj::JjFileLines, String> {
    crate::core::get_file_lines(
        &repo_path,
        workspace_id,
        &file_path,
        from_parent,
        start_line,
        end_line,
    )
}

#[tauri::command]
pub async fn jj_restore_file(workspace_path: String, file_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::core::discard_file_changes(&workspace_path, &file_path)
    })
    .await
    .map_err(|e| format!("Failed to join jj_restore_file task: {}", e))?
}

#[tauri::command]
pub async fn jj_restore_all(workspace_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || crate::core::discard_all_changes(&workspace_path))
        .await
        .map_err(|e| format!("Failed to join jj_restore_all task: {}", e))?
}

#[tauri::command]
pub async fn jj_snapshot_working_copy(workspace_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || core::snapshot_working_copy(&workspace_path))
        .await
        .map_err(|e| format!("Failed to join jj_snapshot_working_copy task: {}", e))?
}

#[tauri::command]
pub async fn snapshot_working_copy(workspace_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || core::snapshot_working_copy(&workspace_path))
        .await
        .map_err(|e| format!("Failed to join snapshot_working_copy task: {}", e))?
}

#[tauri::command]
pub async fn jj_restore_snapshot(
    workspace_path: String,
    snapshot_id: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        core::restore_working_copy_snapshot(&workspace_path, &snapshot_id)
    })
    .await
    .map_err(|e| format!("Failed to join jj_restore_snapshot task: {}", e))?
}

#[tauri::command]
pub async fn restore_working_copy_snapshot(
    workspace_path: String,
    snapshot_id: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        core::restore_working_copy_snapshot(&workspace_path, &snapshot_id)
    })
    .await
    .map_err(|e| format!("Failed to join restore_working_copy_snapshot task: {}", e))?
}

#[tauri::command]
pub async fn discard_workspace_changes(workspace_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || crate::core::discard_all_changes(&workspace_path))
        .await
        .map_err(|e| format!("Failed to join discard_workspace_changes task: {}", e))?
}

#[tauri::command]
pub async fn discard_workspace_file(
    workspace_path: String,
    file_path: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::core::discard_file_changes(&workspace_path, &file_path)
    })
    .await
    .map_err(|e| format!("Failed to join discard_workspace_file task: {}", e))?
}

#[tauri::command]
pub async fn create_commit(
    repo_path: String,
    workspace_id: Option<i64>,
    message: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        log::debug!(
            "create_commit start: repo_path={}, workspace_id={:?}",
            repo_path,
            workspace_id
        );
        let result = crate::core::commit_workspace(&repo_path, workspace_id, &message);
        log::debug!(
            "create_commit end: repo_path={}, workspace_id={:?}, success={}",
            repo_path,
            workspace_id,
            result.is_ok()
        );
        result
    })
    .await
    .map_err(|e| format!("Failed to join create_commit task: {}", e))?
}

#[tauri::command]
pub async fn list_commits(
    repo_path: String,
    workspace_id: Option<i64>,
    include_target_branch_history: Option<bool>,
    target_branch_limit: Option<usize>,
    limit: Option<usize>,
) -> Result<crate::jj::JjLogResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::core::list_commits(
            &repo_path,
            workspace_id,
            include_target_branch_history.unwrap_or(false),
            target_branch_limit,
            limit,
        )
    })
    .await
    .map_err(|e| format!("Failed to join list_commits task: {}", e))?
}

#[tauri::command]
pub async fn jj_split(
    workspace_path: String,
    message: String,
    file_paths: Vec<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        log::debug!("jj_split start: workspace_path={}", workspace_path);
        let result =
            jj::jj_split(&workspace_path, &message, file_paths).map_err(|e| e.to_string())?;

        // Run auto-rebase synchronously so jj state is settled before returning
        if let Some(repo_path) = jj::derive_repo_path_from_workspace(&workspace_path) {
            if let Ok(branch) = jj::get_workspace_branch(&workspace_path) {
                log::debug!(
                    "jj_split auto_rebase start: repo_path={}, branch={}",
                    repo_path,
                    branch
                );
                let _ = crate::auto_rebase::rebase_after_commit(&repo_path, &branch);
                log::debug!(
                    "jj_split auto_rebase end: repo_path={}, branch={}",
                    repo_path,
                    branch
                );
            }
        }

        log::debug!("jj_split end: workspace_path={}", workspace_path);
        Ok(result)
    })
    .await
    .map_err(|e| format!("Failed to join jj_split task: {}", e))?
}

/// Fetch remote branches in background (fire-and-forget)
#[tauri::command]
pub fn jj_git_fetch_background(repo_path: String) -> Result<(), String> {
    std::thread::spawn(move || {
        let _ = jj::jj_git_fetch(&repo_path);
    });
    Ok(())
}

/// Get commits ahead of target branch (commits to be merged)
#[tauri::command]
pub async fn jj_get_commits_ahead(
    workspace_path: String,
    target_branch: String,
) -> Result<jj::JjCommitsAhead, String> {
    tauri::async_runtime::spawn_blocking(move || {
        jj::jj_get_commits_ahead(&workspace_path, &target_branch).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Failed to join jj_get_commits_ahead task: {}", e))?
}

/// Get combined diff between workspace and target branch
#[tauri::command]
pub async fn get_workspace_diff(
    repo_path: String,
    workspace_id: i64,
) -> Result<jj::JjRevisionDiff, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::core::workspace_diff(&repo_path, workspace_id)
    })
    .await
    .map_err(|e| format!("Failed to join get_workspace_diff task: {}", e))?
}

/// Get diff for a single commit by revision (commit_id or change_id)
#[tauri::command]
pub async fn get_commit_diff(
    state: State<'_, AppState>,
    repo_path: String,
    workspace_id: Option<i64>,
    revision: String,
) -> Result<jj::JjRevisionDiff, String> {
    let conflict_style = core::resolve_conflict_marker_style(&state.db);
    tauri::async_runtime::spawn_blocking(move || {
        crate::core::get_commit_diff_with_conflict_style(
            &repo_path,
            workspace_id,
            &revision,
            &conflict_style,
        )
    })
    .await
    .map_err(|e| format!("Failed to join get_commit_diff task: {}", e))?
}

#[tauri::command]
pub async fn get_commit_file_diff(
    state: State<'_, AppState>,
    repo_path: String,
    workspace_id: Option<i64>,
    revision: String,
    file_path: String,
) -> Result<jj::JjFileDiff, String> {
    let conflict_style = core::resolve_conflict_marker_style(&state.db);
    tauri::async_runtime::spawn_blocking(move || {
        crate::core::get_commit_file_diff_with_conflict_style(
            &repo_path,
            workspace_id,
            &revision,
            &file_path,
            &conflict_style,
        )
    })
    .await
    .map_err(|e| format!("Failed to join get_commit_file_diff task: {}", e))?
}

/// Check if a branch exists locally and/or remotely
#[tauri::command]
pub async fn jj_check_branch_exists(
    repo_path: String,
    branch_name: String,
) -> Result<jj::BranchStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        jj::check_branch_exists(&repo_path, &branch_name).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Failed to join jj_check_branch_exists task: {}", e))?
}

#[tauri::command]
pub async fn list_repo_branches(repo_path: String) -> Result<Vec<jj::JjBranch>, String> {
    tauri::async_runtime::spawn_blocking(move || core::list_repo_branches(&repo_path))
        .await
        .map_err(|e| format!("Failed to join list_repo_branches task: {}", e))?
}

/// Switch the repository working copy to the given bookmark (branch).
#[tauri::command]
pub async fn switch_repo_branch(
    repo_path: String,
    bookmark_name: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        core::switch_repo_branch(&repo_path, &bookmark_name)
    })
    .await
    .map_err(|e| format!("Failed to join switch_repo_branch task: {}", e))?
}

/// Get the full (multi-line) description of a specific commit.
#[tauri::command]
pub async fn get_commit_description(
    repo_path: String,
    workspace_id: i64,
    commit_change_id: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        core::get_commit_description(&repo_path, workspace_id, &commit_change_id)
    })
    .await
    .map_err(|e| format!("Failed to join get_commit_description task: {}", e))?
}

/// Edit (rewrite) the description of a specific commit by change-id.
#[tauri::command]
pub async fn describe_commit(
    repo_path: String,
    workspace_id: i64,
    commit_change_id: String,
    description: String,
) -> Result<(), String> {
    let started_at = Instant::now();
    let result = tauri::async_runtime::spawn_blocking({
        let repo_path = repo_path.clone();
        let commit_change_id = commit_change_id.clone();
        move || core::describe_commit(&repo_path, workspace_id, &commit_change_id, &description)
    })
    .await
    .map_err(|e| format!("Failed to join describe_commit task: {}", e))?;
    log::debug!(
        "describe_commit(repo_path={}, workspace_id={}, commit_change_id={}) completed in {:?}",
        repo_path,
        workspace_id,
        commit_change_id,
        started_at.elapsed()
    );
    result
}
