use std::collections::{HashMap, HashSet};
use std::path::Path;

use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};

use crate::auto_rebase::{self, WorkspaceBookmarkConflict};
use crate::core::repo::{commit_lock_for_repo, repo_status};
use crate::jj;
use crate::local_db;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkspaceCommit {
    pub hash: String,
    pub timestamp: String,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct WorkspaceEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub modified_at: Option<String>,
}

/// Defines how a workspace is merged into its target branch.
#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
pub enum MergeCommit {
    Merge,
    SquashAndMerge,
    RebaseAndMerge,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PullWorkspaceResult {
    pub success: bool,
    pub message: String,
    pub was_diverged: bool,
    pub commits_rebased: usize,
    /// True when the pull/rebase left unresolved file conflicts in the workspace.
    /// Callers (e.g. Sync) should surface these for local resolution instead of pushing.
    #[serde(default)]
    pub has_conflicts: bool,
}

pub enum MaybeEmptyParam<T> {
    EmptyValue,
    Omitted,
    Some(T),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SyncSource {
    HomeToWorkspace,
    WorkspaceToHome,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct WorkspaceMoveRequest {
    pub files: Vec<String>,
    pub hunks: Vec<HunkSpec>,
    pub commits: Vec<String>,
}

impl WorkspaceMoveRequest {
    pub fn has_selectors(&self) -> bool {
        !self.files.is_empty() || !self.hunks.is_empty() || !self.commits.is_empty()
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct WorkspaceMoveResult {
    pub commits_moved: usize,
    pub files_moved: usize,
    pub hunks_applied: usize,
    pub hunks_skipped: usize,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct HunkSpec {
    pub file_path: String,
    pub start_line: usize,
    pub end_line: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RenameWorkspaceResult {
    pub success: bool,
    pub message: String,
    pub workspace: Option<local_db::Workspace>,
    pub updated_children_ids: Vec<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(tag = "type", content = "data")]
pub enum RemoteSyncStatus {
    NotOnRemote,
    InSync,
    Ahead { count: usize },
    Behind { count: usize },
    Diverged { ahead: usize, behind: usize },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkspacePartialStatus {
    pub current: local_db::Workspace,
    pub has_conflicts: bool,
    pub has_changes: bool,
    pub commits_ahead: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkspaceSidebarStatus {
    pub current: local_db::Workspace,
    pub has_conflicts: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkspaceStatus {
    #[serde(flatten)]
    pub partial: WorkspacePartialStatus,
    pub conflicted_files: Vec<String>,
    pub remote_sync: RemoteSyncStatus,
    pub target: Option<local_db::Workspace>,
    pub children: Vec<local_db::Workspace>,
    pub dag_nodes: Vec<WorkspaceNode>,
    pub conflicted_workspace_ids: Vec<i64>,
    pub commits_ahead_of_target: Vec<WorkspaceCommit>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkspaceNode {
    pub status: WorkspacePartialStatus,
    pub parent_id: Option<i64>,
    pub child_ids: Vec<i64>,
    pub depth: usize,
}

/// Metadata for workspace creation, supporting both simple description and complex metadata with files.
#[derive(Debug, Default, Serialize, Deserialize, Clone)]
pub struct WorkspaceMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub moved_files: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sparse_patterns: Option<Vec<String>>,
}

/// Parse the creation metadata JSON sent by the frontend/NAPI callers.
/// Unknown fields are ignored; empty arrays are normalized to `None`.
/// Invalid or missing JSON yields an all-`None` metadata.
pub fn parse_workspace_metadata(metadata: Option<&str>) -> WorkspaceMetadata {
    let parsed: Option<WorkspaceMetadata> = metadata.and_then(|m| serde_json::from_str(m).ok());
    let mut parsed = parsed.unwrap_or_default();
    parsed.moved_files = parsed.moved_files.filter(|v| !v.is_empty());
    parsed.sparse_patterns = parsed.sparse_patterns.filter(|v| !v.is_empty());
    parsed
}

fn resolve_workspace_root(repo_path: &str, workspace_id: Option<i64>) -> Result<String, String> {
    match workspace_id {
        Some(id) => {
            let workspace = local_db::get_workspace_by_id(repo_path, id)
                .map_err(|e| format!("Failed to get workspace: {}", e))?
                .ok_or_else(|| format!("Workspace not found: {}", id))?;
            let workspace_path = Path::new(repo_path)
                .join(".treq")
                .join("workspaces")
                .join(&workspace.workspace_path);
            Ok(workspace_path
                .to_str()
                .ok_or("Failed to convert workspace path to string")
                .map(|path| path.to_string())?)
        }
        None => Ok(repo_path.to_string()),
    }
}

pub fn ls_workspace(
    repo_path: &str,
    workspace_id: Option<i64>,
) -> Result<Vec<WorkspaceEntry>, String> {
    let workspace_root = resolve_workspace_root(repo_path, workspace_id)?;
    let base_path = Path::new(&workspace_root);
    let mut entries = Vec::new();

    let walker = WalkBuilder::new(&workspace_root)
        .max_depth(Some(1))
        .hidden(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .parents(true)
        .build();

    for entry in walker {
        let entry = entry.map_err(|e| e.to_string())?;
        let entry_path = entry.path();

        if entry_path == base_path {
            continue;
        }

        if let Some(name) = entry_path.file_name().and_then(|name| name.to_str()) {
            let modified_at = std::fs::metadata(entry_path)
                .ok()
                .and_then(|metadata| metadata.modified().ok())
                .map(|modified| chrono::DateTime::<chrono::Utc>::from(modified).to_rfc3339());
            entries.push(WorkspaceEntry {
                name: name.to_string(),
                path: entry_path.to_string_lossy().to_string(),
                is_directory: entry_path.is_dir(),
                modified_at,
            });
        }
    }

    entries.sort_by(|a, b| match (a.is_directory, b.is_directory) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.cmp(&b.name),
    });

    Ok(entries)
}

pub fn get_workspace_readme(
    repo_path: &str,
    workspace_id: Option<i64>,
) -> Result<Option<String>, String> {
    let readme = ls_workspace(repo_path, workspace_id)?
        .into_iter()
        .find(|entry| !entry.is_directory && entry.name.eq_ignore_ascii_case("README.md"));

    match readme {
        Some(entry) => std::fs::read_to_string(&entry.path)
            .map(Some)
            .map_err(|e| format!("Failed to read workspace README '{}': {}", entry.path, e)),
        None => Ok(None),
    }
}

impl WorkspaceMetadata {
    /// Serialize metadata to JSON string for storage
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| "{}".to_string())
    }
}

pub fn parse_hunk_spec(raw: &str) -> Result<HunkSpec, String> {
    let (file_path, range) = raw
        .rsplit_once(':')
        .ok_or_else(|| format!("Invalid hunk spec '{}': expected file:start-end", raw))?;
    if file_path.is_empty() {
        return Err(format!(
            "Invalid hunk spec '{}': file path cannot be empty",
            raw
        ));
    }
    let (start, end) = range
        .split_once('-')
        .ok_or_else(|| format!("Invalid hunk spec '{}': expected start-end", raw))?;
    let start_line = start
        .parse::<usize>()
        .map_err(|_| format!("Invalid hunk spec '{}': start line is not a number", raw))?;
    let end_line = end
        .parse::<usize>()
        .map_err(|_| format!("Invalid hunk spec '{}': end line is not a number", raw))?;
    if start_line == 0 || end_line == 0 {
        return Err(format!(
            "Invalid hunk spec '{}': line numbers must be >= 1",
            raw
        ));
    }
    if end_line < start_line {
        return Err(format!(
            "Invalid hunk spec '{}': end line must be >= start line",
            raw
        ));
    }
    Ok(HunkSpec {
        file_path: file_path.to_string(),
        start_line,
        end_line,
    })
}

/// Creates a new workspace in the repository.
///
/// # Arguments
/// * `repo_path` - Path to the repository root
/// * `branch_name` - Name of the branch to create
/// * `description` - Description for the workspace
/// * `source_branch` - Source branch to create the workspace from
///
/// # Returns
/// Returns the workspace if successful, otherwise an error message.
pub fn create_workspace(
    repo_path: &str,
    branch_name: &str,
    description: Option<String>,
    moved_files: Option<Vec<String>>,
    source_branch: Option<&str>,
    included_copy_files: Option<Vec<String>>,
    sparse_patterns: Option<Vec<String>>,
) -> Result<local_db::Workspace, String> {
    // None and an empty list both mean a full checkout.
    let sparse_patterns = sparse_patterns.filter(|patterns| !patterns.is_empty());

    // Moved files outside the sparse cone would land in the commit but be invisible on disk.
    if let (Some(patterns), Some(files)) = (&sparse_patterns, &moved_files) {
        for file in files {
            let file = file.trim_end_matches('/');
            let visible = patterns.iter().any(|pattern| {
                let pattern = pattern.trim_end_matches('/');
                file == pattern
                    || file.starts_with(&format!("{}/", pattern))
                    || pattern.starts_with(&format!("{}/", file))
            });
            if !visible {
                return Err(format!(
                    "Moved file '{}' is outside the sparse patterns {:?}; add a covering pattern or deselect the file",
                    file, patterns
                ));
            }
        }
    }

    let stacked_source_workspace = source_branch
        .map(|src_branch| {
            local_db::get_workspace_by_branch(repo_path, src_branch)
                .map_err(|e| format!("Failed to get source workspace: {}", e))
        })
        .transpose()?
        .flatten();

    if let Some(source_workspace) = &stacked_source_workspace {
        let source_workspace_path = Path::new(repo_path)
            .join(".treq")
            .join("workspaces")
            .join(&source_workspace.workspace_path);
        let _ = jj::jj_get_changed_files(&source_workspace_path.to_string_lossy());
    }

    let branches =
        jj::get_branches(repo_path).map_err(|e| format!("Failed to get branches: {}", e))?;

    let branch_exists: bool = branches.iter().any(|b| b.name == branch_name);

    // Always check if branch exists on remote
    let remote_ref = format!("{}@origin", branch_name);
    let branch_exists_on_remote = jj::check_remote_branch_exists(repo_path, &remote_ref)
        .map_err(|e| format!("Failed to check remote branch: {}", e))?;

    let resolved_source_branch = if source_branch.is_none() {
        // A local tracking branch can lag its remote after fetching. In that case,
        // cloning the branch must start at the remote tip rather than whichever
        // side of the imported bookmark conflict happens to sort first.
        if branch_exists_on_remote
            && (!branch_exists || jj::is_local_branch_behind_remote(repo_path, branch_name))
        {
            Some(remote_ref.clone())
        } else {
            None
        }
    } else {
        source_branch.map(|s| s.to_string())
    };

    // Effective target branch for parent resolution: stacked → source branch, plain → default (usually "main").
    let effective_target_branch: String = if let Some(source_ws) = &stacked_source_workspace {
        source_ws.branch_name.clone()
    } else {
        jj::get_default_branch(repo_path).unwrap_or_else(|_| "main".to_string())
    };

    let new_branch: bool = !branch_exists || resolved_source_branch.as_deref() == Some(&remote_ref);
    let workspace_full_path = jj::create_workspace(
        repo_path,
        branch_name,
        branch_name,
        new_branch,
        resolved_source_branch.as_deref(),
        Some(&effective_target_branch),
        sparse_patterns.as_deref(),
    )
    .map_err(|e| format!("Failed to create workspace: {}", e))?;

    // Extract just the sanitized workspace name from the full path
    let workspace_path = Path::new(&workspace_full_path)
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Failed to extract workspace name from path")?
        .to_string();

    let ws_full = Path::new(repo_path)
        .join(".treq")
        .join("workspaces")
        .join(&workspace_path);

    // Copy included files/directories from repo to new workspace
    if let Some(ref patterns) = included_copy_files {
        if !patterns.is_empty() {
            copy_included_files(repo_path, ws_full.to_str().unwrap_or_default(), patterns)?;
        }
    }

    // Copy .claude/settings.local.json so workspaces inherit local permissions/hooks.
    let claude_src = Path::new(repo_path)
        .join(".claude")
        .join("settings.local.json");
    if claude_src.exists() {
        let claude_dst_dir = ws_full.join(".claude");
        std::fs::create_dir_all(&claude_dst_dir)
            .map_err(|e| format!("Failed to create .claude dir in workspace: {}", e))?;
        std::fs::copy(&claude_src, claude_dst_dir.join("settings.local.json"))
            .map_err(|e| format!("Failed to copy .claude/settings.local.json: {}", e))?;
    }

    // Remove any stale db record for this branch so re-creates don't leave duplicates.
    if let Ok(Some(existing)) = local_db::get_workspace_by_branch(repo_path, branch_name) {
        let _ = local_db::delete_workspace(repo_path, existing.id);
    }

    let workspace_id = local_db::add_workspace(
        repo_path,
        workspace_path.clone(),
        workspace_path.clone(),
        branch_name.to_string(),
        description,
        moved_files.clone(),
        sparse_patterns.clone(),
    )
    .map_err(|e| format!("Failed to add workspace to db: {}", e))?;

    // Set not_on_remote flag if branch doesn't exist on remote
    if !branch_exists_on_remote {
        local_db::update_workspace_not_on_remote(repo_path, workspace_id, true)?;
    }

    local_db::update_workspace_target_branch(repo_path, workspace_id, &effective_target_branch)
        .map_err(|e| format!("Failed to set target branch: {}", e))?;

    let workspace = local_db::get_workspace_by_id(repo_path, workspace_id)
        .map_err(|e| format!("Failed to get workspace from db: {}", e))?;
    let workspace = match workspace {
        Some(workspace) => workspace,
        _ => {
            return Err(format!(
                "Workspace not found in database after creation: {}",
                workspace_id
            ))
        }
    };

    // If moved_files are specified, perform the squash operation
    if let Some(files) = moved_files.clone() {
        if !files.is_empty() {
            let source_workspace_path = if let Some(src_branch) = source_branch {
                // For stacked workspaces, squash from the source workspace
                match stacked_source_workspace.as_ref() {
                    Some(ws) => {
                        let workspace_dir = Path::new(repo_path)
                            .join(".treq")
                            .join("workspaces")
                            .join(&ws.workspace_path);
                        workspace_dir.to_string_lossy().to_string()
                    }
                    None => {
                        let source_ws = local_db::get_workspace_by_branch(repo_path, src_branch)
                            .map_err(|e| format!("Failed to get source workspace: {}", e))?;
                        match source_ws {
                            Some(ws) => {
                                let workspace_dir = Path::new(repo_path)
                                    .join(".treq")
                                    .join("workspaces")
                                    .join(&ws.workspace_path);
                                workspace_dir.to_string_lossy().to_string()
                            }
                            None => repo_path.to_string(),
                        }
                    }
                }
            } else {
                // For regular workspaces, squash from the repo root
                repo_path.to_string()
            };

            // Perform the squash operation
            jj::squash_to_workspace(
                &source_workspace_path,
                &workspace.workspace_name,
                Some(files),
            )
            .map_err(|e| format!("Failed to squash files to workspace: {}", e))?;

            let new_workspace_path = Path::new(repo_path)
                .join(".treq")
                .join("workspaces")
                .join(&workspace.workspace_path)
                .to_string_lossy()
                .to_string();
            let _ = jj::update_stale_workspace(&new_workspace_path);
            let _ = jj::update_stale_workspace(&source_workspace_path);
        }
    }

    Ok(workspace)
}

/// Deletes a workspace from the repository.
/// # Arguments
/// * `repo_path` - Path to the repository root
/// * `workspace_id` - ID of the workspace to delete
///
/// # Returns
/// Returns true if successful, false if workspace not found in database.
pub fn delete_workspace(repo_path: &str, workspace_id: &i64) -> Result<bool, String> {
    delete_workspace_impl(
        repo_path,
        workspace_id,
        RemoveWorkspaceDiskMode::JjForgetThenRemoveDir,
    )
}

#[derive(Clone, Copy)]
enum RemoveWorkspaceDiskMode {
    /// `jj workspace forget` (subprocess) then delete `.treq/workspaces/…`.
    JjForgetThenRemoveDir,
    /// Delete `.treq/workspaces/…` only — use when jj already dropped the workspace (e.g. forgotten elsewhere).
    DirectoryOnly,
}

fn delete_workspace_impl(
    repo_path: &str,
    workspace_id: &i64,
    disk: RemoveWorkspaceDiskMode,
) -> Result<bool, String> {
    let workspace = local_db::get_workspace_by_id(repo_path, *workspace_id)
        .map_err(|e| format!("Failed to get workspace from db: {}", e))?;

    match workspace {
        Some(workspace) => {
            let workspace_path = Path::new(repo_path)
                .join(".treq")
                .join("workspaces")
                .join(&workspace.workspace_path);

            // Re-target direct children to the default branch
            let children =
                local_db::get_workspaces_by_target_branch(repo_path, &workspace.branch_name)
                    .map_err(|e| format!("Failed to get child workspaces: {}", e))?;
            if !children.is_empty() {
                let default_branch =
                    jj::get_default_branch(repo_path).unwrap_or_else(|_| "main".to_string());
                for child in &children {
                    local_db::update_workspace_target_branch(repo_path, child.id, &default_branch)
                        .map_err(|e| format!("Failed to update child target branch: {}", e))?;
                }
            }

            // Best effort only: DB cleanup must proceed even if jj/directory removal fails.
            let disk_result = match disk {
                RemoveWorkspaceDiskMode::JjForgetThenRemoveDir => {
                    jj::remove_workspace(repo_path, &workspace_path.to_str().unwrap())
                }
                RemoveWorkspaceDiskMode::DirectoryOnly => {
                    jj::remove_workspace_directory_only(&workspace_path.to_str().unwrap())
                }
            };
            if let Err(e) = disk_result {
                eprintln!("Warning: Failed to remove workspace directory: {}", e);
            }
            local_db::delete_workspace(repo_path, *workspace_id)
                .map_err(|e| format!("Failed to delete workspace from db: {}", e))?;
            Ok(true)
        }
        _ => Err(format!("Workspace not found in database: {}", workspace_id)),
    }
}

/// Push workspace to remote and update not_on_remote flag if successful.
/// # Arguments
/// * `repo_path` - Path to the repository root
/// * `workspace_id` - ID of the workspace (None to push home repo)
/// * `force` - Whether to force push
///
/// # Returns
/// Returns the push result message if successful, otherwise an error message.
pub fn push_workspace_to_remote(
    repo_path: &str,
    workspace_id: Option<i64>,
) -> Result<String, String> {
    // Determine the push path and target branch based on workspace_id
    let (push_path, target_branch) = if let Some(id) = workspace_id {
        // For workspace, look up the path from database
        let workspace = local_db::get_workspace_by_id(repo_path, id)
            .map_err(|e| format!("Failed to get workspace: {}", e))?
            .ok_or_else(|| format!("Workspace not found: {}", id))?;
        let workspace_dir = Path::new(repo_path)
            .join(".treq")
            .join("workspaces")
            .join(&workspace.workspace_path);
        let push_path = workspace_dir
            .to_str()
            .ok_or("Failed to convert workspace path to string")?
            .to_string();
        let target_branch = workspace
            .target_branch
            .clone()
            .unwrap_or_else(|| "main".to_string());
        (push_path, target_branch)
    } else {
        // For home repo, use repo_path directly
        let target_branch =
            jj::get_default_branch(repo_path).unwrap_or_else(|_| "main".to_string());
        (repo_path.to_string(), target_branch)
    };

    // Ensure no empty commits reach the remote; best-effort, never blocks the push.
    let _ = jj::jj_abandon_empty_commits(&push_path, &target_branch);

    // Perform the push
    let result = jj::jj_push(&push_path).map_err(|e| format!("Push failed: {}", e))?;

    // Clear the not_on_remote flag after successful push (only for workspaces)
    if let Some(id) = workspace_id {
        local_db::update_workspace_not_on_remote(repo_path, id, false)?;
    }

    Ok(result)
}

/// Capture a token for the working copy's current content, so it can later
/// be restored with `restore_working_copy_snapshot` — used to undo a discard
/// (`jj_restore_file`/`jj_restore_all`).
pub fn snapshot_working_copy(workspace_path: &str) -> Result<String, String> {
    jj::jj_snapshot_working_copy(workspace_path).map_err(|e| e.to_string())
}

/// Restore the working copy to a snapshot previously captured with
/// `snapshot_working_copy`.
pub fn restore_working_copy_snapshot(
    workspace_path: &str,
    snapshot_id: &str,
) -> Result<String, String> {
    jj::jj_restore_snapshot(workspace_path, snapshot_id).map_err(|e| e.to_string())
}

pub fn list_workspaces(repo_path: &str) -> Result<Vec<local_db::Workspace>, String> {
    local_db::get_workspaces(repo_path).map_err(|e| format!("Failed to get workspaces: {}", e))
}

/// Prunes workspaces whose `.treq/workspaces/…` directories are missing (e.g. deleted outside treq),
/// or whose jj registration was dropped while the directory still exists (e.g. `jj workspace forget`).
pub fn sync_workspaces(repo_path: &str) -> Result<(), String> {
    let workspaces = local_db::get_workspaces(repo_path)?;
    let jj_registered: Option<HashSet<String>> = jj::list_jj_workspaces(repo_path)
        .ok()
        .map(|names| names.into_iter().collect());

    for ws in workspaces {
        let full_path = Path::new(repo_path)
            .join(".treq")
            .join("workspaces")
            .join(&ws.workspace_path);
        if !full_path.exists() {
            delete_workspace(repo_path, &ws.id)?;
            continue;
        }

        if let Some(ref jj_names) = jj_registered {
            if !jj_names.contains(&ws.workspace_name) {
                delete_workspace_impl(repo_path, &ws.id, RemoveWorkspaceDiskMode::DirectoryOnly)?;
            }
        }
    }
    Ok(())
}

/// Lists the minimal workspace status needed by the sidebar.
/// This path is intentionally read-only and subprocess-free.
pub fn list_workspace_statuses(repo_path: &str) -> Result<Vec<WorkspaceSidebarStatus>, String> {
    let discovered = jj::discover_workspaces_with_conflicts(repo_path)
        .map_err(|e| format!("Failed to discover workspaces from jj: {}", e))?;
    let refreshed_at = chrono::Utc::now().to_rfc3339();
    let conflict_by_path: HashMap<String, bool> = discovered
        .iter()
        .map(|workspace| (workspace.workspace_path.clone(), workspace.has_conflicts))
        .collect();
    let persisted = local_db::sync_discovered_workspaces(repo_path, &discovered, &refreshed_at)?;

    persisted
        .into_iter()
        .map(|current| {
            let discovered_has_conflicts = conflict_by_path
                .get(&current.workspace_path)
                .copied()
                .ok_or_else(|| {
                format!(
                    "Discovered workspace missing conflict state after sync: {}",
                    current.workspace_path
                )
            })?;
            let workspace_dir = Path::new(repo_path)
                .join(".treq")
                .join("workspaces")
                .join(&current.workspace_path);
            let workspace_dir_str = workspace_dir
                .to_str()
                .ok_or("Failed to convert workspace path to string")?;
            let unresolved_has_conflicts =
                jj::workspace_has_unresolved_conflicts(workspace_dir_str).map_err(|e| {
                    format!(
                        "Failed to inspect conflict state for sidebar workspace {}: {}",
                        current.workspace_path, e
                    )
                })?;
            let has_conflicts = discovered_has_conflicts || unresolved_has_conflicts;
            Ok(WorkspaceSidebarStatus {
                current,
                has_conflicts,
            })
        })
        .collect()
}

/// Gets the status of a workspace, including parent, children, and full DAG hierarchy.
///
/// # Arguments
/// * `workspace_path` - Full path to the workspace directory
///
/// # Returns
/// Returns a WorkspaceStatus containing the current workspace, parent, children, DAG nodes, and conflicted workspace IDs.
pub fn workspace_status(
    repo_path: &str,
    workspace_id: Option<i64>,
) -> Result<WorkspaceStatus, String> {
    let resolve_status_default_branch = || {
        jj::get_default_branch(repo_path)
            .map_err(|e| format!("Failed to resolve default branch: {}", e))
            .unwrap_or_default()
    };

    // Home repo case: no workspace, build a minimal status
    let workspace_id = match workspace_id {
        Some(id) => id,
        None => {
            let rs = repo_status(repo_path)?;
            if let Some(err) = &rs.fetch_error {
                log::warn!("Home repo fetch: {}", err);
            }
            let default_branch = resolve_status_default_branch();

            // Synthesize a Workspace-like entry for the home repo
            let home_workspace = local_db::Workspace {
                id: 0,
                repo_path: repo_path.to_string(),
                workspace_name: "home".to_string(),
                workspace_path: repo_path.to_string(),
                branch_name: default_branch.clone(),
                created_at: String::new(),
                refreshed_at: None,
                metadata: None,
                target_branch: None,
                title: default_branch.clone(),
                description: None,
                moved_files: None,
                not_on_remote: false,
                sparse_patterns: None,
            };

            let conflicted_files =
                jj::get_conflicted_files(repo_path, Some(&default_branch)).unwrap_or_default();

            return Ok(WorkspaceStatus {
                partial: WorkspacePartialStatus {
                    current: home_workspace,
                    has_conflicts: rs.has_conflicts || !conflicted_files.is_empty(),
                    has_changes: rs.has_changes,
                    commits_ahead: 0,
                },
                conflicted_files,
                remote_sync: rs.remote_sync,
                target: None,
                children: Vec::new(),
                dag_nodes: Vec::new(),
                conflicted_workspace_ids: Vec::new(),
                commits_ahead_of_target: Vec::new(),
            });
        }
    };

    // Workspace case: look up from DB
    let all_workspaces = local_db::get_workspaces(repo_path)
        .map_err(|e| format!("Failed to get workspaces: {}", e))?;

    let current_workspace = all_workspaces
        .iter()
        .find(|w| w.id == workspace_id)
        .cloned()
        .ok_or_else(|| format!("Workspace not found: {}", workspace_id))?;

    let workspace_path = Path::new(repo_path)
        .join(".treq")
        .join("workspaces")
        .join(&current_workspace.workspace_path);
    let workspace_path_str = workspace_path
        .to_str()
        .ok_or("Failed to convert workspace path to string")?;

    // Build branch_name → Workspace lookup map
    let branch_map: HashMap<String, &local_db::Workspace> = all_workspaces
        .iter()
        .map(|w| (w.branch_name.clone(), w))
        .collect();

    // Find direct parent (workspace whose branch_name matches current.target_branch)
    let target = current_workspace
        .target_branch
        .as_ref()
        .and_then(|target| branch_map.get(target).map(|w| (*w).clone()));

    // Find direct children (workspaces where target_branch matches current.branch_name)
    let children: Vec<local_db::Workspace> =
        local_db::get_workspaces_by_target_branch(&repo_path, &current_workspace.branch_name)
            .unwrap_or_default();

    let dag_nodes = Vec::new();
    let conflicted_workspace_ids = Vec::new();

    // Calculate commits ahead of target
    let commits_ahead_of_target = if let Some(target_workspace) = &target {
        match jj::jj_get_commits_ahead(workspace_path_str, &target_workspace.branch_name) {
            Ok(commits_ahead) => commits_ahead
                .commits
                .iter()
                .map(|c| WorkspaceCommit {
                    hash: c.commit_id.clone(),
                    timestamp: c.timestamp.clone(),
                    message: c.description.clone(),
                })
                .collect(),
            Err(_) => Vec::new(),
        }
    } else {
        // No target branch, commits are ahead of the repository default branch.
        let default_branch = resolve_status_default_branch();
        if default_branch.is_empty() {
            Vec::new()
        } else {
            match jj::jj_get_commits_ahead(workspace_path_str, &default_branch) {
                Ok(commits_ahead) => commits_ahead
                    .commits
                    .iter()
                    .map(|c| WorkspaceCommit {
                        hash: c.commit_id.clone(),
                        timestamp: c.timestamp.clone(),
                        message: c.description.clone(),
                    })
                    .collect(),
                Err(_) => Vec::new(),
            }
        }
    };

    let has_changes = jj::jj_get_changed_files(workspace_path_str)
        .map(|files| !files.is_empty())
        .unwrap_or(false);
    let conflict_target = current_workspace
        .target_branch
        .clone()
        .unwrap_or_else(resolve_status_default_branch);
    let conflicted_files = if conflict_target.is_empty() {
        jj::get_conflicted_files(workspace_path_str, None).unwrap_or_default()
    } else {
        jj::get_conflicted_files(workspace_path_str, Some(&conflict_target)).unwrap_or_default()
    };
    let has_conflicts = jj::workspace_has_unresolved_conflicts(workspace_path_str).unwrap_or(false);

    let commits_ahead_count = commits_ahead_of_target.len();

    let remote_sync = if current_workspace.not_on_remote {
        RemoteSyncStatus::NotOnRemote
    } else if jj::jj_is_bookmark_conflicted(workspace_path_str, &current_workspace.branch_name) {
        match jj::jj_get_diverged_sync_counts(workspace_path_str, &current_workspace.branch_name) {
            Ok((ahead, behind)) => RemoteSyncStatus::Diverged { ahead, behind },
            Err(_) => RemoteSyncStatus::Diverged {
                ahead: 0,
                behind: 0,
            },
        }
    } else {
        match jj::jj_get_sync_status(workspace_path_str, &current_workspace.branch_name, false) {
            Ok((ahead, behind)) => match (ahead, behind) {
                (0, 0) => RemoteSyncStatus::InSync,
                (a, 0) => RemoteSyncStatus::Ahead { count: a },
                (0, b) => RemoteSyncStatus::Behind { count: b },
                (a, b) => RemoteSyncStatus::Diverged {
                    ahead: a,
                    behind: b,
                },
            },
            Err(_) => RemoteSyncStatus::NotOnRemote,
        }
    };

    Ok(WorkspaceStatus {
        partial: WorkspacePartialStatus {
            current: current_workspace,
            has_conflicts,
            has_changes,
            commits_ahead: commits_ahead_count,
        },
        conflicted_files,
        remote_sync,
        target,
        children,
        dag_nodes,
        conflicted_workspace_ids,
        commits_ahead_of_target,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        parse_hunk_spec, parse_workspace_metadata, plan_workspace_target_move,
        resolve_workspace_diff_base_revision_from_last_rebased,
        resolve_workspace_diff_conflict_marker_style,
        resolve_workspace_diff_tip_revision_from_workspace_state, HunkSpec, WorkspaceMoveRequest,
        WorkspaceTargetMoveStep,
    };
    use crate::local_db::Workspace;
    use rusqlite::Connection;
    use std::sync::{Mutex, OnceLock};
    use tempfile::TempDir;

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    fn test_workspace(id: i64, branch: &str, target: Option<&str>) -> Workspace {
        Workspace {
            id,
            repo_path: "/tmp/repo".to_string(),
            workspace_name: branch.to_string(),
            workspace_path: format!("ws/{}", branch),
            branch_name: branch.to_string(),
            created_at: "2026-01-01T00:00:00.000Z".to_string(),
            refreshed_at: None,
            metadata: None,
            target_branch: target.map(str::to_string),
            title: branch.to_string(),
            description: None,
            moved_files: None,
            not_on_remote: false,
            sparse_patterns: None,
        }
    }

    #[test]
    fn plan_move_onto_non_descendant_is_single_step() {
        let parent = test_workspace(1, "feat/parent", Some("main"));
        let other = test_workspace(2, "feat/other", Some("main"));
        let child = test_workspace(3, "feat/child", Some("feat/parent"));

        let steps = plan_workspace_target_move(
            &[parent.clone(), other, child.clone()],
            "feat/child",
            "feat/other",
            "main",
        )
        .expect("plan should succeed");

        assert_eq!(
            steps,
            vec![WorkspaceTargetMoveStep {
                workspace_id: child.id,
                branch_name: "feat/child".to_string(),
                new_target_branch: "feat/other".to_string(),
            }]
        );
    }

    #[test]
    fn plan_parent_below_child_lifts_child_first() {
        let parent = test_workspace(1, "feat/parent", Some("main"));
        let child = test_workspace(2, "feat/child", Some("feat/parent"));

        let steps = plan_workspace_target_move(
            &[parent.clone(), child.clone()],
            "feat/parent",
            "feat/child",
            "main",
        )
        .expect("plan should succeed");

        assert_eq!(
            steps,
            vec![
                WorkspaceTargetMoveStep {
                    workspace_id: child.id,
                    branch_name: "feat/child".to_string(),
                    new_target_branch: "main".to_string(),
                },
                WorkspaceTargetMoveStep {
                    workspace_id: parent.id,
                    branch_name: "feat/parent".to_string(),
                    new_target_branch: "feat/child".to_string(),
                },
            ]
        );
    }

    #[test]
    fn plan_three_level_root_below_tip_lifts_bridge() {
        let a = test_workspace(1, "feat/a", Some("main"));
        let b = test_workspace(2, "feat/b", Some("feat/a"));
        let c = test_workspace(3, "feat/c", Some("feat/b"));

        let steps =
            plan_workspace_target_move(&[a.clone(), b.clone(), c], "feat/a", "feat/c", "main")
                .expect("plan should succeed");

        assert_eq!(
            steps,
            vec![
                WorkspaceTargetMoveStep {
                    workspace_id: b.id,
                    branch_name: "feat/b".to_string(),
                    new_target_branch: "main".to_string(),
                },
                WorkspaceTargetMoveStep {
                    workspace_id: a.id,
                    branch_name: "feat/a".to_string(),
                    new_target_branch: "feat/c".to_string(),
                },
            ]
        );
    }

    #[test]
    fn plan_middle_below_child_in_three_level_stack() {
        let a = test_workspace(1, "feat/a", Some("main"));
        let b = test_workspace(2, "feat/b", Some("feat/a"));
        let c = test_workspace(3, "feat/c", Some("feat/b"));

        let steps =
            plan_workspace_target_move(&[a, b.clone(), c.clone()], "feat/b", "feat/c", "main")
                .expect("plan should succeed");

        assert_eq!(
            steps,
            vec![
                WorkspaceTargetMoveStep {
                    workspace_id: c.id,
                    branch_name: "feat/c".to_string(),
                    new_target_branch: "feat/a".to_string(),
                },
                WorkspaceTargetMoveStep {
                    workspace_id: b.id,
                    branch_name: "feat/b".to_string(),
                    new_target_branch: "feat/c".to_string(),
                },
            ]
        );
    }

    #[test]
    fn plan_rejects_self_target() {
        let parent = test_workspace(1, "feat/parent", Some("main"));
        let err = plan_workspace_target_move(&[parent], "feat/parent", "feat/parent", "main")
            .expect_err("self target should fail");
        assert!(err.to_lowercase().contains("cycle"));
    }

    #[test]
    fn plan_uses_default_branch_when_lifting_off_null_target_root() {
        let parent = test_workspace(1, "feat/parent", None);
        let child = test_workspace(2, "feat/child", Some("feat/parent"));

        let steps = plan_workspace_target_move(
            &[parent.clone(), child.clone()],
            "feat/parent",
            "feat/child",
            "develop",
        )
        .expect("plan should succeed");

        assert_eq!(
            steps,
            vec![
                WorkspaceTargetMoveStep {
                    workspace_id: child.id,
                    branch_name: "feat/child".to_string(),
                    new_target_branch: "develop".to_string(),
                },
                WorkspaceTargetMoveStep {
                    workspace_id: parent.id,
                    branch_name: "feat/parent".to_string(),
                    new_target_branch: "feat/child".to_string(),
                },
            ]
        );
    }

    #[test]
    fn parse_workspace_metadata_full_json() {
        let parsed = parse_workspace_metadata(Some(
            r#"{"title":"T","description":"D","moved_files":["a.rs"],"sparse_patterns":["src","docs"]}"#,
        ));
        assert_eq!(parsed.title.as_deref(), Some("T"));
        assert_eq!(parsed.description.as_deref(), Some("D"));
        assert_eq!(parsed.moved_files, Some(vec!["a.rs".to_string()]));
        assert_eq!(
            parsed.sparse_patterns,
            Some(vec!["src".to_string(), "docs".to_string()])
        );
    }

    #[test]
    fn parse_workspace_metadata_missing_fields_and_empty_arrays() {
        let parsed = parse_workspace_metadata(Some(
            r#"{"title":"T","moved_files":[],"sparse_patterns":[]}"#,
        ));
        assert_eq!(parsed.title.as_deref(), Some("T"));
        assert_eq!(parsed.description, None);
        assert_eq!(parsed.moved_files, None, "empty array should become None");
        assert_eq!(
            parsed.sparse_patterns, None,
            "empty array should become None"
        );

        let absent = parse_workspace_metadata(None);
        assert_eq!(absent.title, None);
        assert_eq!(absent.sparse_patterns, None);

        let invalid = parse_workspace_metadata(Some("not json"));
        assert_eq!(invalid.title, None);
        assert_eq!(invalid.sparse_patterns, None);
    }

    #[test]
    fn resolve_workspace_diff_conflict_marker_style_defaults_when_settings_table_missing() {
        let _guard = env_lock().lock().unwrap();
        let temp_dir = TempDir::new().expect("temp dir should be created");
        let db_path = temp_dir.path().join("treq.db");
        Connection::open(&db_path)
            .expect("db should be openable")
            .execute("CREATE TABLE unrelated (id INTEGER PRIMARY KEY)", [])
            .expect("setup table should succeed");

        std::env::set_var("TREQ_APP_DB_PATH", db_path.to_string_lossy().to_string());
        let style = resolve_workspace_diff_conflict_marker_style("/unused/repo/path");
        std::env::remove_var("TREQ_APP_DB_PATH");

        assert_eq!(
            style.expect("should resolve style"),
            crate::core::DEFAULT_CONFLICT_MARKER_STYLE
        );
    }

    #[test]
    fn resolve_workspace_diff_base_revision_prefers_last_rebased_commit() {
        let base = resolve_workspace_diff_base_revision_from_last_rebased(
            Some("  abc123  ".to_string()),
            "main",
        );
        assert_eq!(base, "abc123");
    }

    #[test]
    fn resolve_workspace_diff_base_revision_falls_back_to_target_branch() {
        assert_eq!(
            resolve_workspace_diff_base_revision_from_last_rebased(None, "main"),
            "main"
        );
        assert_eq!(
            resolve_workspace_diff_base_revision_from_last_rebased(Some("   ".to_string()), "dev"),
            "dev"
        );
    }

    #[test]
    fn resolve_workspace_diff_tip_revision_prefers_workspace_branch_over_parent_pointer() {
        let tip = resolve_workspace_diff_tip_revision_from_workspace_state("feature", "main", 3);
        assert_eq!(tip, "feature");
    }

    #[test]
    fn resolve_workspace_diff_tip_revision_uses_parent_pointer_only_for_empty_target_workspace() {
        let tip = resolve_workspace_diff_tip_revision_from_workspace_state("main", "main", 0);
        assert_eq!(tip, "@-");
    }

    #[test]
    fn parse_hunk_spec_accepts_file_range_format() {
        let spec = parse_hunk_spec("src/main.rs:10-20").expect("valid hunk spec");
        assert_eq!(
            spec,
            HunkSpec {
                file_path: "src/main.rs".to_string(),
                start_line: 10,
                end_line: 20,
            }
        );
    }

    #[test]
    fn parse_hunk_spec_rejects_malformed_values() {
        assert!(parse_hunk_spec("src/main.rs").is_err());
        assert!(parse_hunk_spec("src/main.rs:10").is_err());
        assert!(parse_hunk_spec("src/main.rs:abc-10").is_err());
        assert!(parse_hunk_spec("src/main.rs:20-10").is_err());
    }

    #[test]
    fn workspace_move_request_requires_at_least_one_selector() {
        let request = WorkspaceMoveRequest::default();
        assert!(!request.has_selectors());
    }
}

/// Merges a workspace's commits into the home repository and cleans up the workspace.
///
/// # Arguments
/// * `repo_path` - Path to the repository root
/// * `workspace_id` - ID of the workspace to merge
/// * `message` - Commit message for the merge
///
/// # Returns
/// Returns Ok(()) on success, or an error message on failure.
pub fn merge_workspace(
    repo_path: &str,
    workspace_id: i64,
    message: &str,
    merge_strategy: MergeCommit,
) -> Result<(), String> {
    // Get the workspace from the database
    let workspace = local_db::get_workspace_by_id(repo_path, workspace_id)
        .map_err(|e| format!("Failed to get workspace from db: {}", e))?
        .ok_or("Workspace not found in database")?;

    let workspace_path = Path::new(repo_path)
        .join(".treq")
        .join("workspaces")
        .join(&workspace.workspace_path);

    let workspace_path_str = workspace_path
        .to_str()
        .ok_or("Failed to convert workspace path to string")?;

    // Get target branch for comparison
    let target_branch = workspace.target_branch.as_deref().unwrap_or("main");

    // Abandon empty commits before merge to keep history clean
    let _ = jj::jj_abandon_empty_commits(workspace_path_str, target_branch);

    // Get commits ahead of target
    let commits_ahead = jj::jj_get_commits_ahead(workspace_path_str, target_branch)
        .map_err(|e| format!("Failed to get commits: {}", e))?;

    if commits_ahead.commits.is_empty() {
        return Err("No commits to merge".to_string());
    }

    match merge_strategy {
        MergeCommit::Merge => {
            jj::jj_create_merge_commit(
                workspace_path_str,
                &workspace.branch_name,
                target_branch,
                message,
                "diff",
            )
            .map_err(|e| format!("Failed to create merge commit: {}", e))?;
        }
        MergeCommit::SquashAndMerge => {
            jj::jj_squash_merge_commit(
                workspace_path_str,
                &workspace.branch_name,
                target_branch,
                message,
            )
            .map_err(|e| format!("Failed to squash merge workspace: {}", e))?;
        }
        MergeCommit::RebaseAndMerge => {
            let rebase_result = jj::jj_rebase_merge_commit(
                workspace_path_str,
                &workspace.branch_name,
                target_branch,
                message,
            )
            .map_err(|e| format!("Failed to rebase merge workspace: {}", e))?;

            if !rebase_result.success {
                return Err(format!("Rebase merge failed: {}", rebase_result.message));
            }
        }
    }

    jj::jj_edit_bookmark(repo_path, target_branch)
        .map_err(|e| format!("Failed to update home repo to target branch: {}", e))?;
    if workspace.branch_name == target_branch {
        sync_home_and_workspace_for_branch(repo_path, target_branch, SyncSource::WorkspaceToHome)?;
    }

    // Remove the workspace from jj (also deletes the workspace directory)
    jj::remove_workspace(repo_path, workspace_path_str)
        .map_err(|e| format!("Failed to remove workspace from jj: {}", e))?;

    // Remove from database
    local_db::delete_workspace(repo_path, workspace_id)
        .map_err(|e| format!("Failed to delete workspace from db: {}", e))?;

    Ok(())
}

fn sync_home_and_workspace_for_branch(
    repo_path: &str,
    branch: &str,
    source: SyncSource,
) -> Result<(), String> {
    if branch.is_empty() || branch == "HEAD" {
        return Ok(());
    }

    let home_branch = jj::resolve_home_repo_branch(repo_path)
        .map_err(|e| format!("Failed to resolve home repo branch: {}", e))?;
    if home_branch.is_empty() || home_branch == "HEAD" || home_branch != branch {
        return Ok(());
    }

    let workspace = match local_db::get_workspace_by_branch(repo_path, branch)
        .map_err(|e| format!("Failed to get workspace by branch: {}", e))?
    {
        Some(workspace) => workspace,
        None => return Ok(()),
    };
    let workspace_path = Path::new(repo_path)
        .join(".treq")
        .join("workspaces")
        .join(&workspace.workspace_path);
    let workspace_path_str = workspace_path
        .to_str()
        .ok_or("Failed to convert workspace path to string")?;

    let source_path = match source {
        SyncSource::HomeToWorkspace => repo_path,
        SyncSource::WorkspaceToHome => workspace_path_str,
    };
    let _ = jj::jj_workspace_update_stale(source_path);
    // Use `@-` when `@` is the empty working copy, so no empty commit gets pushed.
    let source_tip = jj::jj_resolve_bookmark_tip(source_path)
        .map_err(|e| format!("Failed to resolve source tip: {}", e))?;

    let destination_path = match source {
        SyncSource::HomeToWorkspace => workspace_path_str,
        SyncSource::WorkspaceToHome => repo_path,
    };
    let _ = jj::jj_workspace_update_stale(destination_path);
    jj::jj_set_bookmark(destination_path, branch, &source_tip).map_err(|e| {
        format!(
            "Failed to force-sync destination bookmark '{}' to source tip: {}",
            branch, e
        )
    })?;
    match source {
        SyncSource::WorkspaceToHome => {
            jj::jj_edit_bookmark(destination_path, branch).map_err(|e| {
                format!(
                    "Failed to sync destination working copy to branch '{}': {}",
                    branch, e
                )
            })?;
            let _ = jj::jj_workspace_update_stale(destination_path);
        }
        SyncSource::HomeToWorkspace => {
            let _ = jj::jj_workspace_update_stale(destination_path);
            // Move @ onto the new bookmark tip so the workspace working copy stays in sync (avoids infinite auto-sync loop).
            if let Err(e) = jj::jj_sync_working_copy_if_safe(destination_path, branch) {
                log::warn!(
                    "sync_home_and_workspace_for_branch: could not sync workspace @ to '{}': {}",
                    branch,
                    e
                );
            }
        }
    }
    Ok(())
}

/// One target_branch update in a cycle-safe retarget plan.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceTargetMoveStep {
    pub workspace_id: i64,
    pub branch_name: String,
    pub new_target_branch: String,
}

fn is_descendant_of(workspaces: &[local_db::Workspace], candidate: &str, ancestor: &str) -> bool {
    if candidate == ancestor {
        return false;
    }

    let by_branch: HashMap<&str, &local_db::Workspace> = workspaces
        .iter()
        .map(|ws| (ws.branch_name.as_str(), ws))
        .collect();

    let mut current = candidate;
    let mut visited = HashSet::new();

    loop {
        if !visited.insert(current) {
            return false;
        }
        let Some(ws) = by_branch.get(current) else {
            return false;
        };
        let Some(target) = ws.target_branch.as_deref() else {
            return false;
        };
        if target == ancestor {
            return true;
        }
        current = target;
    }
}

/// Plan `target_branch` updates so `moving_branch` can target `new_target_branch`
/// without creating a cycle.
///
/// When the new target is a descendant (parent dragged below a child), the
/// immediate child of `moving_branch` on the path to the new target is lifted
/// onto `moving_branch`'s current parent first, then the move is applied.
pub fn plan_workspace_target_move(
    workspaces: &[local_db::Workspace],
    moving_branch: &str,
    new_target_branch: &str,
    default_branch: &str,
) -> Result<Vec<WorkspaceTargetMoveStep>, String> {
    let by_branch: HashMap<&str, &local_db::Workspace> = workspaces
        .iter()
        .map(|ws| (ws.branch_name.as_str(), ws))
        .collect();

    let Some(moving) = by_branch.get(moving_branch) else {
        return Ok(vec![]);
    };

    if moving_branch == new_target_branch {
        return Err("Cannot target self: would create a cycle".to_string());
    }

    let mut steps = Vec::new();

    if is_descendant_of(workspaces, new_target_branch, moving_branch) {
        let mut current = new_target_branch;
        let mut visited = HashSet::new();
        let mut bridge: Option<&local_db::Workspace> = None;

        loop {
            if !visited.insert(current) {
                break;
            }
            let Some(ws) = by_branch.get(current) else {
                break;
            };
            let Some(target) = ws.target_branch.as_deref() else {
                break;
            };
            if target == moving_branch {
                bridge = Some(ws);
                break;
            }
            current = target;
        }

        if let Some(bridge) = bridge {
            let lift_target = moving.target_branch.as_deref().unwrap_or(default_branch);
            if lift_target != bridge.branch_name {
                steps.push(WorkspaceTargetMoveStep {
                    workspace_id: bridge.id,
                    branch_name: bridge.branch_name.clone(),
                    new_target_branch: lift_target.to_string(),
                });
            }
        }
    }

    steps.push(WorkspaceTargetMoveStep {
        workspace_id: moving.id,
        branch_name: moving.branch_name.clone(),
        new_target_branch: new_target_branch.to_string(),
    });

    Ok(steps)
}

/// Rebase a single workspace onto `target_branch` and persist the target.
pub fn apply_workspace_target_branch(
    repo_path: &str,
    workspace_id: i64,
    target_branch: &str,
) -> Result<local_db::Workspace, String> {
    let workspace = local_db::get_workspace_by_id(repo_path, workspace_id)
        .map_err(|e| format!("Failed to get workspace from db: {}", e))?
        .ok_or("Workspace not found in database")?;

    let workspace_path = Path::new(repo_path)
        .join(".treq")
        .join("workspaces")
        .join(&workspace.workspace_path);
    let workspace_path_str = workspace_path
        .to_str()
        .ok_or("Failed to convert workspace path to string")?;

    let _ = jj::jj_git_fetch(repo_path);

    let rebase_result = jj::jj_rebase_workspace_bookmark_onto(
        workspace_path_str,
        &workspace.branch_name,
        target_branch,
    )
    .map_err(|e| format!("Failed to rebase workspace: {}", e))?;

    if !rebase_result.success {
        return Err(format!("Rebase failed: {}", rebase_result.message));
    }

    local_db::update_workspace_target_branch(repo_path, workspace_id, target_branch)
        .map_err(|e| format!("Failed to update target branch: {}", e))?;

    local_db::get_workspace_by_id(repo_path, workspace_id)
        .map_err(|e| format!("Failed to get updated workspace: {}", e))?
        .ok_or_else(|| "Workspace not found after update".to_string())
}

/// Retarget a workspace onto `new_target_branch`, lifting bridge children first
/// when needed so parent/child stack reorders stay acyclic.
///
/// Shared by the UI (`set_workspace_target_branch` / `update_workspace`) and CLI
/// (`treq set -t`).
pub fn retarget_workspace(
    repo_path: &str,
    workspace_id: i64,
    new_target_branch: &str,
    default_branch: &str,
) -> Result<local_db::Workspace, String> {
    let workspaces = local_db::get_workspaces(repo_path)
        .map_err(|e| format!("Failed to list workspaces: {}", e))?;
    let moving = workspaces
        .iter()
        .find(|ws| ws.id == workspace_id)
        .ok_or("Workspace not found in database")?;

    let steps = plan_workspace_target_move(
        &workspaces,
        &moving.branch_name,
        new_target_branch,
        default_branch,
    )?;

    let mut updated = None;
    for step in steps {
        updated = Some(apply_workspace_target_branch(
            repo_path,
            step.workspace_id,
            &step.new_target_branch,
        )?);
    }

    updated.ok_or_else(|| "No retarget steps produced".to_string())
}

/// Updates a workspace's target branch and/or description.
/// Rebases the workspace to the target branch and updates metadata.
/// The workspace's branch name remains unchanged.
pub fn update_workspace(
    repo_path: &str,
    workspace_id: i64,
    target_branch: MaybeEmptyParam<String>,
    description: MaybeEmptyParam<String>,
) -> Result<local_db::Workspace, String> {
    update_workspace_with_title(
        repo_path,
        workspace_id,
        target_branch,
        MaybeEmptyParam::Omitted,
        description,
    )
}

pub fn update_workspace_with_title(
    repo_path: &str,
    workspace_id: i64,
    target_branch: MaybeEmptyParam<String>,
    title: MaybeEmptyParam<String>,
    description: MaybeEmptyParam<String>,
) -> Result<local_db::Workspace, String> {
    let _workspace = local_db::get_workspace_by_id(repo_path, workspace_id)
        .map_err(|e| format!("Failed to get workspace from db: {}", e))?
        .ok_or("Workspace not found in database")?;

    match target_branch {
        MaybeEmptyParam::EmptyValue => {
            retarget_workspace(repo_path, workspace_id, "main", "main")?;
        }
        MaybeEmptyParam::Some(branch) => {
            retarget_workspace(repo_path, workspace_id, &branch, "main")?;
        }
        MaybeEmptyParam::Omitted => {}
    }

    if let MaybeEmptyParam::Some(title_str) = title {
        local_db::update_workspace_title(repo_path, workspace_id, &title_str)
            .map_err(|e| format!("Failed to update title: {}", e))?;
    }

    if let MaybeEmptyParam::Some(description_str) = description {
        local_db::update_workspace_description(repo_path, workspace_id, &description_str)
            .map_err(|e| format!("Failed to update description: {}", e))?;
    }

    local_db::get_workspace_by_id(repo_path, workspace_id)
        .map_err(|e| format!("Failed to get updated workspace: {}", e))?
        .ok_or_else(|| "Workspace not found after update".to_string())
}

/// Renames a workspace's jj bookmark/branch.
///
/// In dry_run mode, validates the new name (checks for clashes with existing local/remote
/// branches) without performing the rename.
///
/// # Arguments
/// * `repo_path` - Path to the repository root
/// * `workspace_id` - ID of the workspace to rename
/// * `new_branch_name` - The new branch name
/// * `dry_run` - If true, only validate without performing the rename
pub fn rename_workspace(
    repo_path: &str,
    workspace_id: i64,
    new_branch_name: &str,
    dry_run: bool,
) -> Result<RenameWorkspaceResult, String> {
    // 1. Look up workspace by ID
    let workspace = local_db::get_workspace_by_id(repo_path, workspace_id)
        .map_err(|e| format!("Failed to get workspace: {}", e))?
        .ok_or("Workspace not found")?;

    let old_branch_name = &workspace.branch_name;

    // 2. Check same-name
    if old_branch_name == new_branch_name {
        return Ok(RenameWorkspaceResult {
            success: false,
            message: "New name is the same as the current name".to_string(),
            workspace: None,
            updated_children_ids: vec![],
        });
    }

    // 3. Check local branch clash
    let branches =
        jj::get_branches(repo_path).map_err(|e| format!("Failed to get branches: {}", e))?;
    if branches.iter().any(|b| b.name == new_branch_name) {
        return Ok(RenameWorkspaceResult {
            success: false,
            message: format!("Branch '{}' already exists locally", new_branch_name),
            workspace: None,
            updated_children_ids: vec![],
        });
    }

    // 4. Check remote branch clash
    let remote_ref = format!("{}@origin", new_branch_name);
    let remote_exists = jj::check_remote_branch_exists(repo_path, &remote_ref)
        .map_err(|e| format!("Failed to check remote branch: {}", e))?;
    if remote_exists {
        return Ok(RenameWorkspaceResult {
            success: false,
            message: format!("Branch '{}' already exists on remote", new_branch_name),
            workspace: None,
            updated_children_ids: vec![],
        });
    }

    // 5. If dry_run, return success without performing the rename
    if dry_run {
        return Ok(RenameWorkspaceResult {
            success: true,
            message: format!("'{}' is available", new_branch_name),
            workspace: None,
            updated_children_ids: vec![],
        });
    }

    // 6. Construct full workspace path
    let workspace_path = Path::new(repo_path)
        .join(".treq")
        .join("workspaces")
        .join(&workspace.workspace_path);
    let workspace_path_str = workspace_path
        .to_str()
        .ok_or("Failed to convert workspace path to string")?;

    // 7. Check if old bookmark was tracked
    let was_tracked =
        jj::is_bookmark_tracked(workspace_path_str, old_branch_name, "origin").unwrap_or(false);

    // 8. Set new bookmark at same revision as old
    jj::jj_set_bookmark(workspace_path_str, new_branch_name, old_branch_name)
        .map_err(|e| format!("Failed to set new bookmark: {}", e))?;

    // 9. Delete old bookmark
    jj::jj_delete_bookmark(workspace_path_str, old_branch_name)
        .map_err(|e| format!("Failed to delete old bookmark: {}", e))?;

    // 10. If was tracked, best-effort track new bookmark
    if was_tracked {
        let _ = jj::jj_bookmark_track(workspace_path_str, new_branch_name, "origin");
    }

    // 11. Update branch name in DB
    local_db::update_workspace_branch_name(repo_path, workspace_id, new_branch_name)
        .map_err(|e| format!("Failed to update branch name in DB: {}", e))?;

    // 12. Mark as not_on_remote (new name hasn't been pushed)
    local_db::update_workspace_not_on_remote(repo_path, workspace_id, true)
        .map_err(|e| format!("Failed to update not_on_remote: {}", e))?;

    // 13. Update children targeting the old branch name
    let children = local_db::get_workspaces_by_target_branch(repo_path, old_branch_name)
        .map_err(|e| format!("Failed to get child workspaces: {}", e))?;

    let mut updated_children_ids = Vec::new();
    for child in &children {
        local_db::update_workspace_target_branch(repo_path, child.id, new_branch_name)
            .map_err(|e| format!("Failed to update child target branch: {}", e))?;
        updated_children_ids.push(child.id);
    }

    // 14. Return updated workspace
    let updated_workspace = local_db::get_workspace_by_id(repo_path, workspace_id)
        .map_err(|e| format!("Failed to get updated workspace: {}", e))?;

    Ok(RenameWorkspaceResult {
        success: true,
        message: format!("Renamed '{}' to '{}'", old_branch_name, new_branch_name),
        workspace: updated_workspace,
        updated_children_ids,
    })
}
/// Reserved source/destination name for `move_workspace_changes` that refers to the
/// home repo (the repo root outside of any `.treq` workspace) instead of a registered
/// workspace. Mirrors the shell convention for "here" (the home repo root).
pub const HOME_MOVE_ENDPOINT: &str = ".";

fn is_home_move_endpoint(branch: &str) -> bool {
    branch == HOME_MOVE_ENDPOINT
}

struct MoveEndpoint {
    /// `None` for the home repo, `Some(id)` for a registered workspace.
    workspace_id: Option<i64>,
    full_path: String,
}

fn resolve_move_endpoint(
    repo_path: &str,
    branch: &str,
    label: &str,
) -> Result<MoveEndpoint, String> {
    if is_home_move_endpoint(branch) {
        return Ok(MoveEndpoint {
            workspace_id: None,
            full_path: repo_path.to_string(),
        });
    }

    let workspace = local_db::get_workspace_by_branch(repo_path, branch)
        .map_err(|e| format!("Failed to look up {} workspace: {}", label, e))?
        .ok_or_else(|| format!("{} workspace '{}' not found", label, branch))?;
    let full_path = Path::new(repo_path)
        .join(".treq")
        .join("workspaces")
        .join(&workspace.workspace_path);
    let full_path_str = full_path
        .to_str()
        .ok_or_else(|| format!("Failed to convert {} workspace path to string", label))?
        .to_string();

    Ok(MoveEndpoint {
        workspace_id: Some(workspace.id),
        full_path: full_path_str,
    })
}

pub fn move_workspace_changes(
    repo_path: &str,
    source_branch: &str,
    destination_branch: &str,
    request: WorkspaceMoveRequest,
) -> Result<WorkspaceMoveResult, String> {
    if !request.has_selectors() {
        return Err("Must specify at least one selector: -f, -r, or -c".to_string());
    }
    if source_branch == destination_branch
        || (is_home_move_endpoint(source_branch) && is_home_move_endpoint(destination_branch))
    {
        return Err("Source and destination must be different".to_string());
    }

    let source = resolve_move_endpoint(repo_path, source_branch, "Source")?;
    let destination = resolve_move_endpoint(repo_path, destination_branch, "Destination")?;

    let source_full_path_str = source.full_path;
    let destination_full_path_str = destination.full_path;

    let mut result = WorkspaceMoveResult {
        commits_moved: 0,
        files_moved: 0,
        hunks_applied: 0,
        hunks_skipped: 0,
        warnings: Vec::new(),
    };
    let mut commits_to_abandon_from_source: Vec<String> = Vec::new();

    if !request.commits.is_empty() {
        let source_log =
            crate::core::commits::list_commits(repo_path, source.workspace_id, false, None, None)?;
        let history_ids: HashSet<String> = source_log
            .commits
            .iter()
            .flat_map(|commit| [commit.change_id.clone(), commit.commit_id.clone()])
            .filter(|id| !id.is_empty())
            .collect();
        for commit_id in &request.commits {
            if !history_ids.contains(commit_id) {
                return Err(format!(
                    "Commit '{}' not found in source workspace history",
                    commit_id
                ));
            }
        }

        for commit_id in &request.commits {
            let commit_paths = jj::jj_diff_summary(&source_full_path_str, commit_id)
                .map_err(|e| format!("Failed to diff commit '{}': {}", commit_id, e))?;
            jj::move_paths_between_workspace_paths(
                &source_full_path_str,
                &destination_full_path_str,
                Some(commit_paths),
            )
            .map_err(|e| format!("Failed to move commit to destination workspace: {}", e))?;
            jj::update_stale_workspace(&destination_full_path_str).map_err(|e| {
                format!("Failed to update destination workspace working copy: {}", e)
            })?;
            commits_to_abandon_from_source.push(commit_id.clone());
            result.commits_moved += 1;
        }
    }

    // Preserve commit-moved files across abandon-triggered destination checkout.
    let mut commit_moved_file_saves: Vec<(String, Vec<u8>)> = Vec::new();
    for commit_id in &commits_to_abandon_from_source {
        if let Ok(file_paths) = jj::jj_diff_summary(&source_full_path_str, commit_id) {
            for file_path in file_paths {
                let dest_file = std::path::Path::new(&destination_full_path_str).join(&file_path);
                if let Ok(content) = std::fs::read(&dest_file) {
                    commit_moved_file_saves.push((file_path, content));
                }
            }
        }
    }

    if !request.files.is_empty() {
        // Record the source changes before the filesystem transfer so tracked
        // files can be restored to their parent state rather than left deleted.
        jj::jj_get_changed_files(&source_full_path_str)
            .map_err(|e| format!("Failed to snapshot source files: {}", e))?;
        jj::move_paths_between_workspace_paths(
            &source_full_path_str,
            &destination_full_path_str,
            Some(request.files.clone()),
        )
        .map_err(|e| format!("Failed to move files: {}", e))?;
        // Source restoration can reconcile other workspaces and check out the
        // destination before its copied paths have been snapshotted. Preserve
        // those bytes across that rewrite, then snapshot them afterward.
        let destination_file_saves: Vec<(String, Option<Vec<u8>>)> = request
            .files
            .iter()
            .map(|file_path| {
                let path = Path::new(&destination_full_path_str).join(file_path);
                (file_path.clone(), std::fs::read(path).ok())
            })
            .collect();
        for file_path in &request.files {
            jj::jj_restore_file(&source_full_path_str, file_path)
                .map_err(|e| format!("Failed to restore source file '{}': {}", file_path, e))?;
        }
        for (file_path, content) in destination_file_saves {
            let path = Path::new(&destination_full_path_str).join(&file_path);
            if let Some(content) = content {
                if let Some(parent) = path.parent() {
                    std::fs::create_dir_all(parent)
                        .map_err(|e| format!("Failed to recreate destination directory: {}", e))?;
                }
                std::fs::write(&path, content)
                    .map_err(|e| format!("Failed to restore destination file: {}", e))?;
            } else if path.exists() {
                std::fs::remove_file(&path)
                    .map_err(|e| format!("Failed to restore destination deletion: {}", e))?;
            }
        }
        jj::jj_get_changed_files(&destination_full_path_str)
            .map_err(|e| format!("Failed to snapshot destination files: {}", e))?;
        result.files_moved = request.files.len();
    }

    if !request.hunks.is_empty() {
        let hunk_outcome = jj::move_hunks_between_workspaces(
            &source_full_path_str,
            &destination_full_path_str,
            &request.hunks,
        )
        .map_err(|e| format!("Failed to move hunks: {}", e))?;
        result.hunks_applied = hunk_outcome.applied;
        result.hunks_skipped = hunk_outcome.skipped;
        result.warnings.extend(hunk_outcome.warnings);
    }

    for commit_id in &commits_to_abandon_from_source {
        jj::jj_abandon(&source_full_path_str, commit_id)
            .map_err(|e| format!("Failed to abandon commit: {}", e))?;
        jj::update_stale_workspace(&source_full_path_str)
            .map_err(|e| format!("Failed to update source workspace working copy: {}", e))?;
    }

    // Restore files that destination checkout may have removed.
    for (file_path, content) in &commit_moved_file_saves {
        let dest_file = std::path::Path::new(&destination_full_path_str).join(file_path);
        if let Some(parent) = dest_file.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&dest_file, content);
    }

    let _ = jj::update_stale_workspace(&source_full_path_str);
    let _ = jj::update_stale_workspace(&destination_full_path_str);

    Ok(result)
}

/// Pull a workspace from remote, automatically resolving divergence by rebasing
/// local mutable commits onto the remote tip.
///
/// When the local bookmark has diverged from its remote counterpart (both have
/// new commits), this function:
/// 1. Fetches remote changes
/// 2. Captures local-only commit IDs (before resolving the bookmark)
/// 3. Resolves the bookmark conflict by pointing to the remote tip
/// 4. Rebases local mutable commits onto the new bookmark tip
/// 5. Refreshes the working copy
pub fn pull_workspace_from_remote(
    repo_path: &str,
    workspace_id: Option<i64>,
    conflict_marker_style: &str,
) -> Result<PullWorkspaceResult, String> {
    // When workspace_id is None, do a simple pull for the home repo
    let workspace_id = match workspace_id {
        Some(id) => id,
        None => {
            // For home repo, just fetch — do not rebase, which would detach HEAD
            jj::jj_git_fetch(repo_path).map_err(|e| format!("Fetch failed: {}", e))?;
            let home_branch = jj::resolve_home_repo_branch(repo_path)
                .map_err(|e| format!("Failed to resolve home repo branch: {}", e))?;
            sync_home_and_workspace_for_branch(
                repo_path,
                &home_branch,
                SyncSource::HomeToWorkspace,
            )?;
            return Ok(PullWorkspaceResult {
                success: true,
                message: "Fetched home repo".to_string(),
                was_diverged: false,
                commits_rebased: 0,
                has_conflicts: false,
            });
        }
    };

    // Look up workspace from DB
    let workspace = local_db::get_workspace_by_id(repo_path, workspace_id)
        .map_err(|e| format!("Failed to get workspace: {}", e))?
        .ok_or_else(|| format!("Workspace not found: {}", workspace_id))?;

    let full_path = Path::new(repo_path)
        .join(".treq")
        .join("workspaces")
        .join(&workspace.workspace_path);
    let full_path_str = full_path
        .to_str()
        .ok_or("Failed to convert workspace path to string")?;

    let branch_name = &workspace.branch_name;

    // Step 1: Fetch remote changes
    jj::jj_git_fetch(repo_path).map_err(|e| format!("Fetch failed: {}", e))?;

    // Step 2: Check if bookmark is conflicted (diverged)
    let is_conflicted = jj::jj_is_bookmark_conflicted(full_path_str, branch_name);

    if !is_conflicted {
        // No divergence — try to sync working copy if safe
        let _ = jj::jj_workspace_update_stale(full_path_str);
        let _ = jj::jj_sync_working_copy_if_safe(full_path_str, branch_name);

        return Ok(PullWorkspaceResult {
            success: true,
            message: "Fetched remote changes (no divergence)".to_string(),
            was_diverged: false,
            commits_rebased: 0,
            has_conflicts: workspace_pull_has_conflicts(full_path_str, branch_name),
        });
    }

    // Step 3: Diverged — capture local-only commit IDs BEFORE resolving bookmark
    let remote_ref = format!("{}@origin", branch_name);
    let local_revset = format!("({}..@-) & mutable()", remote_ref);
    let local_commit_ids = jj::jj_log_revset_commit_ids(full_path_str, &local_revset)
        .map_err(|e| format!("Failed to capture local commits: {}", e))?;

    let commits_rebased = local_commit_ids.len();

    // Step 4: Resolve bookmark conflict — point local bookmark to remote tip
    jj::jj_set_bookmark(full_path_str, branch_name, &remote_ref)
        .map_err(|e| format!("Failed to resolve bookmark conflict: {}", e))?;

    // Step 5: Rebase local commits onto the new bookmark tip (if any)
    if !local_commit_ids.is_empty() {
        let ids_revset = local_commit_ids.join(" | ");
        let roots_revset = format!("roots({})", ids_revset);

        jj::jj_rebase_with_revset(
            full_path_str,
            &roots_revset,
            branch_name,
            branch_name,
            conflict_marker_style,
        )
        .map_err(|e| format!("Failed to rebase local commits: {}", e))?;

        // Step 5b: Advance the bookmark to the rebased local tip.
        // Without this, the bookmark stays on origin and Sync reports InSync while
        // conflicted/rebased work only lives on @ — users can't resolve locally and push.
        advance_bookmark_to_working_copy_tip(full_path_str, branch_name)?;
    }

    // Step 6: refresh stale working copy only; do not sync bookmark tip here.
    let _ = jj::jj_workspace_update_stale(full_path_str);
    sync_home_and_workspace_for_branch(repo_path, branch_name, SyncSource::WorkspaceToHome)?;

    let has_conflicts = workspace_pull_has_conflicts(full_path_str, branch_name);

    Ok(PullWorkspaceResult {
        success: true,
        message: if has_conflicts {
            format!(
                "Rebased {} local commit(s) onto remote tip with conflicts to resolve",
                commits_rebased
            )
        } else {
            format!(
                "Resolved divergence: rebased {} local commit(s) onto remote tip",
                commits_rebased
            )
        },
        was_diverged: true,
        commits_rebased,
        has_conflicts,
    })
}

pub fn resolve_workspace_bookmark_conflict(
    repo_path: &str,
    workspace_id: i64,
    workspace_path: &str,
    branch_name: &str,
) -> Result<jj::BookmarkConflictResolutionResult, String> {
    let target = format!("{branch_name}@origin");
    let result = jj::jj_resolve_bookmark_conflict_losslessly(workspace_path, branch_name, &target)
        .map_err(|e| e.to_string())?;
    let tip = jj::jj_get_commit_id(workspace_path, branch_name).map_err(|e| e.to_string())?;
    local_db::update_workspace_last_rebased_commit(repo_path, workspace_id, &tip)
        .map_err(|e| format!("Failed to update workspace rebase state: {e}"))?;
    Ok(result)
}

/// Point `branch_name` at the workspace tip (`@-` when `@` is the empty WC commit).
fn advance_bookmark_to_working_copy_tip(
    workspace_path: &str,
    branch_name: &str,
) -> Result<(), String> {
    let tip = jj::jj_resolve_bookmark_tip(workspace_path)
        .map_err(|e| format!("Failed to resolve rebased tip: {}", e))?;
    jj::jj_set_bookmark(workspace_path, branch_name, &tip).map_err(|e| {
        format!(
            "Failed to advance bookmark '{}' to rebased tip: {}",
            branch_name, e
        )
    })
}

fn workspace_pull_has_conflicts(workspace_path: &str, _branch_name: &str) -> bool {
    if jj::workspace_has_unresolved_conflicts(workspace_path).unwrap_or(false) {
        return true;
    }
    !jj::get_conflicted_files(workspace_path, None)
        .unwrap_or_default()
        .is_empty()
}

/// Copies files/directories listed in `patterns` from `repo_path` into `workspace_dir`.
/// Each pattern is an exact file or directory name relative to the repo root.
/// Missing patterns are silently skipped.
pub fn copy_included_files(
    repo_path: &str,
    workspace_dir: &str,
    patterns: &[String],
) -> Result<(), String> {
    let repo = Path::new(repo_path);
    let workspace = Path::new(workspace_dir);

    for pattern in patterns {
        let source = repo.join(pattern);
        if !source.exists() {
            continue;
        }
        let dest = workspace.join(pattern);
        if source.is_file() {
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create directory {:?}: {}", parent, e))?;
            }
            std::fs::copy(&source, &dest)
                .map_err(|e| format!("Failed to copy file {:?}: {}", source, e))?;
        } else if source.is_dir() {
            copy_dir_recursive(&source, &dest)?;
        }
    }
    Ok(())
}

/// Gets the combined diff of all workspace commits relative to the target branch.
///
/// This shows only the changes introduced by the workspace's own commits,
/// excluding changes already present on the target branch.
///
/// # Arguments
/// * `repo_path`              - Path to the repository root
/// * `workspace_id`           - ID of the workspace
/// * `db`                     - App database for reading settings
///
/// # Returns
/// The parsed revision diff on success, or an error string.
pub fn workspace_diff(repo_path: &str, workspace_id: i64) -> Result<jj::JjRevisionDiff, String> {
    let conflict_marker_style = resolve_workspace_diff_conflict_marker_style(repo_path)?;

    workspace_diff_with_conflict_style(repo_path, workspace_id, &conflict_marker_style)
}

fn resolve_workspace_diff_conflict_marker_style(repo_path: &str) -> Result<String, String> {
    let app_db_path = crate::core::resolve_app_db_path(repo_path);
    if !app_db_path.exists() {
        return Err(format!(
            "Failed to access app database at {}: file does not exist",
            app_db_path.display()
        ));
    }
    let db = crate::db::Database::new(app_db_path.clone()).map_err(|e| {
        format!(
            "Failed to access app database at {}: {}",
            app_db_path.display(),
            e
        )
    })?;
    match db.get_setting("conflict_marker_style") {
        Ok(Some(value)) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                Ok(crate::core::DEFAULT_CONFLICT_MARKER_STYLE.to_string())
            } else {
                Ok(trimmed.to_string())
            }
        }
        Ok(None) => Ok(crate::core::DEFAULT_CONFLICT_MARKER_STYLE.to_string()),
        // Settings table not yet initialized → default; other db errors propagate.
        Err(e) if e.to_string().contains("no such table") => {
            Ok(crate::core::DEFAULT_CONFLICT_MARKER_STYLE.to_string())
        }
        Err(e) => Err(format!(
            "Failed to read app database setting conflict_marker_style: {}",
            e
        )),
    }
}

fn workspace_diff_with_conflict_style(
    repo_path: &str,
    workspace_id: i64,
    conflict_marker_style: &str,
) -> Result<jj::JjRevisionDiff, String> {
    let workspace = local_db::get_workspace_by_id(repo_path, workspace_id)
        .map_err(|e| format!("Failed to get workspace: {}", e))?
        .ok_or_else(|| format!("Workspace not found: {}", workspace_id))?;

    let target_branch = workspace.target_branch.as_deref().unwrap_or("main");
    let workspace_dir = Path::new(repo_path)
        .join(".treq")
        .join("workspaces")
        .join(&workspace.workspace_path);
    let workspace_dir_str = workspace_dir
        .to_str()
        .ok_or("Failed to convert workspace path to string")?;
    let base_revision =
        resolve_workspace_diff_base_revision(repo_path, &workspace, workspace_dir_str)?;
    let tip_revision =
        resolve_workspace_diff_tip_revision(repo_path, &workspace, workspace_dir_str)?;

    let mut diff = jj::jj_get_merge_diff_between_revisions(
        workspace_dir_str,
        &base_revision,
        &tip_revision,
        conflict_marker_style,
    )
    .map_err(|e| format!("Failed to get workspace diff: {}", e))?;

    let uncommitted_files = jj::jj_get_changed_files(workspace_dir_str)
        .map_err(|e| format!("Failed to get uncommitted workspace changes: {}", e))?;
    let uncommitted_paths: std::collections::HashSet<String> = uncommitted_files
        .iter()
        .map(|file| file.path.clone())
        .collect();
    let conflicted_files = jj::get_conflicted_files(workspace_dir_str, Some(target_branch))
        .map_err(|e| format!("Failed to get conflicted workspace files: {}", e))?;
    let conflicted_paths: std::collections::HashSet<String> =
        conflicted_files.iter().cloned().collect();
    diff.committed_files.retain(|file| {
        !uncommitted_paths.contains(&file.path) || conflicted_paths.contains(&file.path)
    });
    diff.uncommitted_files = uncommitted_files;
    diff.conflicted_files = conflicted_files;

    Ok(diff)
}

fn resolve_workspace_diff_base_revision(
    repo_path: &str,
    workspace: &local_db::Workspace,
    workspace_dir_str: &str,
) -> Result<String, String> {
    let target_branch = workspace.target_branch.as_deref().unwrap_or("main");
    let last_rebased_target_commit =
        local_db::get_workspace_last_rebased_commit(repo_path, workspace.id)?;
    let base_revision = resolve_workspace_diff_base_revision_from_last_rebased(
        last_rebased_target_commit,
        target_branch,
    );
    if base_revision != target_branch {
        let current_tip = jj::jj_get_commit_id(workspace_dir_str, &workspace.branch_name)
            .map_err(|e| format!("Failed to resolve workspace tip: {}", e))?;
        if current_tip != base_revision {
            return Ok(base_revision);
        }
    }
    if workspace.branch_name == target_branch {
        let committed_ahead = jj::jj_get_commits_ahead(workspace_dir_str, target_branch)
            .map_err(|e| format!("Failed to get workspace commits ahead: {}", e))?;
        if committed_ahead.total_count == 0 {
            return Ok("@".to_string());
        }
    }

    Ok(target_branch.to_string())
}

fn resolve_workspace_diff_tip_revision(
    _repo_path: &str,
    workspace: &local_db::Workspace,
    workspace_dir_str: &str,
) -> Result<String, String> {
    let target_branch = workspace.target_branch.as_deref().unwrap_or("main");
    let committed_ahead = jj::jj_get_commits_ahead(workspace_dir_str, &workspace.branch_name)
        .map_err(|e| format!("Failed to get workspace commits ahead: {}", e))?;
    Ok(resolve_workspace_diff_tip_revision_from_workspace_state(
        &workspace.branch_name,
        target_branch,
        committed_ahead.total_count,
    ))
}

fn resolve_workspace_diff_tip_revision_from_workspace_state(
    branch_name: &str,
    target_branch: &str,
    committed_ahead_count: usize,
) -> String {
    if branch_name == target_branch && committed_ahead_count == 0 {
        "@-".to_string()
    } else {
        branch_name.to_string()
    }
}

fn resolve_workspace_diff_base_revision_from_last_rebased(
    last_rebased_target_commit: Option<String>,
    target_branch: &str,
) -> String {
    last_rebased_target_commit
        .map(|commit| commit.trim().to_string())
        .filter(|commit| !commit.is_empty())
        .unwrap_or_else(|| target_branch.to_string())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst)
        .map_err(|e| format!("Failed to create directory {:?}: {}", dst, e))?;
    for entry in
        std::fs::read_dir(src).map_err(|e| format!("Failed to read directory {:?}: {}", src, e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)
                .map_err(|e| format!("Failed to copy file {:?}: {}", src_path, e))?;
        }
    }
    Ok(())
}

// Rebase

/// Serializable result returned to callers (including the Tauri frontend).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SingleRebaseResult {
    pub rebased: bool,
    pub success: bool,
    pub message: String,
    pub bookmark_conflicts: Vec<WorkspaceBookmarkConflict>,
}

/// Check and optionally rebase workspaces against their target branch.
///
/// - `workspace_id = Some(id)` — rebase only that workspace (uses `default_branch` as fallback
///   when the workspace has no `target_branch` set, and respects `force`).
/// - `workspace_id = None` — rebase all workspaces in the repo that have a `target_branch`.
pub fn check_and_rebase_workspaces(
    repo_path: &str,
    workspace_id: Option<i64>,
    default_branch: Option<String>,
    force: Option<bool>,
    conflict_style: &str,
) -> Result<SingleRebaseResult, String> {
    // Dashboard/ShowWorkspace refreshes and post-commit auto-rebase can overlap. jj transactions
    // share one operation store across all workspaces, so serialize these history rewrites with
    // commits to prevent stale operations, competing checkouts, and conflicted bookmarks.
    let repo_commit_lock = commit_lock_for_repo(repo_path);
    let _repo_commit_guard = repo_commit_lock.lock().unwrap();

    if let Some(id) = workspace_id {
        let default_branch = default_branch.unwrap_or_else(|| "main".to_string());
        let force = force.unwrap_or(false);
        let result = if force {
            auto_rebase::rebase_root_subtree_from_workspace_force(
                repo_path,
                id,
                &default_branch,
                conflict_style,
            )?
        } else {
            auto_rebase::rebase_single_workspace(
                repo_path,
                id,
                &default_branch,
                force,
                conflict_style,
            )?
        };

        match result {
            Some(auto_result) => Ok(SingleRebaseResult {
                rebased: true,
                success: auto_result.rebase_result.success,
                message: auto_result.rebase_result.message,
                bookmark_conflicts: auto_result.bookmark_conflicts,
            }),
            None => Ok(SingleRebaseResult {
                rebased: false,
                success: true,
                message: "No rebase needed".to_string(),
                bookmark_conflicts: Vec::new(),
            }),
        }
    } else {
        let results = auto_rebase::check_and_rebase_all(repo_path, conflict_style)?;

        let rebased_count: usize = results.iter().map(|r| r.workspaces_rebased.len()).sum();
        let all_success = results.iter().all(|r| r.rebase_result.success);
        let bookmark_conflicts: Vec<WorkspaceBookmarkConflict> = results
            .iter()
            .flat_map(|r| r.bookmark_conflicts.clone())
            .collect();

        let mut summary = String::new();
        for result in &results {
            summary.push_str(&format!(
                "Target '{}': rebased {} workspace(s) - {}\n",
                result.target_branch,
                result.workspaces_rebased.len(),
                if result.rebase_result.success {
                    "success"
                } else {
                    "failed"
                }
            ));
        }
        if results.is_empty() {
            summary.push_str("No workspaces with target branches to rebase\n");
        }

        Ok(SingleRebaseResult {
            rebased: rebased_count > 0,
            success: all_success,
            message: summary,
            bookmark_conflicts,
        })
    }
}

pub fn commit_workspace<T>(
    repo_path: &str,
    workspace_id: T,
    message: &str,
) -> Result<String, String>
where
    T: Into<Option<i64>>,
{
    let workspace_id = workspace_id.into();
    let repo_commit_lock = commit_lock_for_repo(repo_path);
    let _repo_commit_guard = repo_commit_lock.lock().unwrap();
    let workspace_root = resolve_workspace_root(repo_path, workspace_id)?;
    let (committed_branch, target_branch) = if let Some(id) = workspace_id {
        let workspace = local_db::get_workspace_by_id(repo_path, id)
            .map_err(|e| format!("Failed to get workspace: {}", e))?
            .ok_or_else(|| format!("Workspace not found: {}", id))?;
        let target_branch = workspace
            .target_branch
            .clone()
            .unwrap_or_else(|| "main".to_string());
        (workspace.branch_name, target_branch)
    } else {
        let branch = jj::resolve_home_repo_branch(repo_path)
            .map_err(|e| format!("Failed to resolve home repo branch: {}", e))?;
        let target_branch =
            jj::get_default_branch(repo_path).unwrap_or_else(|_| "main".to_string());
        (branch, target_branch)
    };

    let result = jj::jj_commit(&workspace_root, message)
        .map_err(|e| format!("Failed to create commit: {}", e))?;
    // Keep branch history free of empty commits; best-effort, never fails the commit.
    let _ = jj::jj_abandon_empty_commits(&workspace_root, &target_branch);
    if !committed_branch.is_empty() {
        if let Some(id) = workspace_id {
            if let Ok(new_tip) = jj::jj_get_commit_id(&workspace_root, &committed_branch) {
                let _ = local_db::update_workspace_last_rebased_commit(repo_path, id, &new_tip);
            }
        }
    }
    if !committed_branch.is_empty() {
        let _ = auto_rebase::rebase_after_commit(repo_path, &committed_branch);
    }
    match workspace_id {
        Some(_) => sync_home_and_workspace_for_branch(
            repo_path,
            &committed_branch,
            SyncSource::WorkspaceToHome,
        )?,
        None => sync_home_and_workspace_for_branch(
            repo_path,
            &committed_branch,
            SyncSource::HomeToWorkspace,
        )?,
    };

    Ok(result)
}
