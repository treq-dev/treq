import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  CachedDirectoryEntry,
  DiffCacheEntry,
  DirectoryEntry,
  FileBrowserPendingReview,
  FileSearchResult,
  JjRevisionDiff,
  LineComment,
  PendingReview,
  PrCiStatus,
  PrInfo,
  PromptHistoryEntry,
  ResolveCommitResult,
  ResolveConflictsSession,
  Session,
  StashEntry,
} from "./api-types";

export const setGitSubmoduleSynced = (
  repoPath: string,
  path: string,
  enabled: boolean,
): Promise<void> =>
  invoke("set_git_submodule_synced", { repoPath, path, enabled });

export const startResolveConflicts = (
  repoPath: string,
  workspaceId: number | null,
  changeIds?: string[] | null,
): Promise<ResolveConflictsSession> =>
  invoke("start_resolve_conflicts", {
    repoPath,
    workspaceId,
    changeIds: changeIds ?? null,
  });

export const buildResolveAgentPrompt = (
  userPrompt: string,
  session: ResolveConflictsSession,
): Promise<string> =>
  invoke("build_resolve_agent_prompt", {
    userPrompt,
    session,
  });

export const resolveCommit = (
  repoPath: string,
  revision: string,
  sides: string[],
): Promise<ResolveCommitResult> =>
  invoke("resolve_commit", {
    repoPath,
    revision,
    sides,
  });

export const ptyCreateSession = (
  sessionId: string,
  workingDir?: string,
  shell?: string,
  initialCommand?: string,
  suppressEchoFor?: string,
): Promise<void> =>
  invoke("pty_create_session", {
    sessionId,
    workingDir,
    shell,
    initialCommand,
    suppressEchoFor,
  });

export const ptyWrite = (sessionId: string, data: string): Promise<void> =>
  invoke("pty_write", { sessionId, data });

export const ptyWriteSuppressEcho = (
  sessionId: string,
  data: string,
): Promise<void> => invoke("pty_write_suppress_echo", { sessionId, data });

export const ptyResize = (
  sessionId: string,
  rows: number,
  cols: number,
): Promise<void> => invoke("pty_resize", { sessionId, rows, cols });

export const ptyClose = (sessionId: string): Promise<void> =>
  invoke("pty_close", { sessionId });

export const ptySessionExists = (sessionId: string): Promise<boolean> =>
  invoke("pty_session_exists", { sessionId });

export const ptyListen = (
  sessionId: string,
  callback: (data: string) => void,
) =>
  listen<string>(`pty-data-${sessionId}`, (event) => callback(event.payload));

// File System API
export const readFile = (path: string): Promise<string> =>
  invoke("read_file", { path });

export const writeSendReviewImage = (
  repoPath: string,
  suggestedName: string,
  contentsBase64: string,
): Promise<string> =>
  invoke("write_send_review_image", {
    repoPath,
    suggestedName,
    contentsBase64,
  });

export const writeAgentCliFiles = (
  prompt: string,
  settingsJson?: string | null,
  cwd?: string | null,
): Promise<{
  promptPath: string;
  settingsPath?: string;
  skillDir: string;
  agentsSkillPath?: string;
  claudeSkillPath?: string;
  skillWriteWarning?: string;
}> =>
  invoke("write_agent_cli_files", {
    prompt,
    settingsJson: settingsJson ?? null,
    cwd: cwd ?? null,
  });

export const cleanupAgentCliFiles = (paths: string[]): Promise<void> =>
  invoke("cleanup_agent_cli_files", { paths });

export const getFileModifiedAt = (path: string): Promise<string | null> =>
  invoke("get_file_modified_at", { path });

export const listDirectory = (path: string): Promise<DirectoryEntry[]> =>
  invoke("list_directory", { path });

export interface SendArtifactRecord {
  id: string;
  repo: string;
  pty_session_id?: string | null;
  media_type: string;
  path: string;
  title?: string | null;
  received_at: number;
}

export const listSendArtifacts = (
  repoPath: string,
): Promise<SendArtifactRecord[]> => invoke("list_send_artifacts", { repoPath });

export const listDirectoryCached = (
  repoPath: string,
  workspaceId: number | null,
  parentPath: string,
): Promise<CachedDirectoryEntry[]> =>
  invoke("list_directory_cached", {
    repoPath,
    workspaceId,
    parentPath,
  });

export const searchWorkspaceFiles = (
  repoPath: string,
  workspaceId: number | null,
  query: string,
  limit?: number,
): Promise<FileSearchResult[]> =>
  invoke("search_workspace_files", {
    repoPath,
    workspaceId,
    query,
    limit: limit ?? 50,
  });

// Folder picker
export const selectFolder = async (): Promise<string | null> =>
  open({
    directory: true,
    multiple: false,
    title: "Select Folder",
  });

// Session management API
export const createSession = (
  repoPath: string,
  workspaceId: number | null,
  name: string,
): Promise<number> => invoke("create_session", { repoPath, workspaceId, name });

export type AgentDispatchAcknowledgmentStatus = "accepted" | "rejected";

export const acknowledgeAgentDispatch = (
  requestId: string,
  status: AgentDispatchAcknowledgmentStatus,
  reason?: string,
): Promise<void> =>
  invoke("acknowledge_agent_dispatch", {
    requestId,
    status,
    reason: reason ?? null,
  });
export const getSessions = (repoPath: string): Promise<Session[]> =>
  invoke("get_sessions", { repoPath });

export const updateSessionAccess = (
  repoPath: string,
  id: number,
): Promise<void> => invoke("update_session_access", { repoPath, id });

export const getSessionModel = (
  repoPath: string,
  id: number,
): Promise<string | null> => invoke("get_session_model", { repoPath, id });

export const setSessionModel = (
  repoPath: string,
  id: number,
  model: string | null,
): Promise<void> => invoke("set_session_model", { repoPath, id, model });

// Prompt history API
export const addPromptHistory = (
  repoPath: string,
  workspaceId: number | null,
  sessionId: number | null,
  promptText: string,
  agent?: string | null,
): Promise<number> =>
  invoke("add_prompt_history", {
    repoPath,
    workspaceId,
    sessionId,
    promptText,
    agent: agent ?? null,
  });

export const getPromptHistory = (
  repoPath: string,
): Promise<PromptHistoryEntry[]> => invoke("get_prompt_history", { repoPath });

export const getWorkspaceStartingPrompt = (
  repoPath: string,
  workspaceId: number,
): Promise<PromptHistoryEntry | null> =>
  invoke("get_workspace_starting_prompt", { repoPath, workspaceId });

// Stash API — immutable local gist storage for working-copy change sets
export const stashWorkspaceChanges = (
  repoPath: string,
  workspaceId: number | null,
): Promise<StashEntry> =>
  invoke("stash_workspace_changes", { repoPath, workspaceId });

export const stashCommit = (
  repoPath: string,
  workspaceId: number | null,
  changeId: string,
): Promise<StashEntry> =>
  invoke("stash_commit", { repoPath, workspaceId, changeId });

export const listStashes = (repoPath: string): Promise<StashEntry[]> =>
  invoke("list_stashes", { repoPath });

export const deleteStash = (repoPath: string, stashId: number): Promise<void> =>
  invoke("delete_stash", { repoPath, stashId });

export const applyStash = (
  repoPath: string,
  stashId: number,
  targetBranch: string,
): Promise<void> => invoke("apply_stash", { repoPath, stashId, targetBranch });

export const getStashDiff = (
  repoPath: string,
  stashId: number,
): Promise<JjRevisionDiff> => invoke("get_stash_diff", { repoPath, stashId });

export const exportStashGitPatch = (
  repoPath: string,
  stashId: number,
): Promise<string> => invoke("export_stash_git_patch", { repoPath, stashId });

export const markFileViewed = (
  workspacePath: string,
  filePath: string,
  contentHash: string,
): Promise<void> =>
  invoke("mark_file_viewed", { workspacePath, filePath, contentHash });

export const unmarkFileViewed = (
  workspacePath: string,
  filePath: string,
): Promise<void> => invoke("unmark_file_viewed", { workspacePath, filePath });

// Diff cache API (in-memory stub implementation)
const diffCache = new Map<string, { data: string; timestamp: number }>();

export const getDiffCache = async (
  workspacePath: string,
  cacheType: string,
  filePath?: string,
): Promise<DiffCacheEntry | null> => {
  const key = filePath
    ? `${workspacePath}:${cacheType}:${filePath}`
    : `${workspacePath}:${cacheType}`;
  return diffCache.get(key) ?? null;
};

export const loadPendingReview = (
  repoPath: string,
  workspaceId: number,
): Promise<PendingReview | null> =>
  invoke("load_pending_review", { repoPath, workspaceId }).then((review) => {
    if (!review) return null;
    const normalized = { ...review } as PendingReview & {
      comments: unknown;
      viewed_files: unknown;
    };
    if (typeof normalized.comments === "string") {
      normalized.comments = JSON.parse(normalized.comments);
    }
    if (typeof normalized.viewed_files === "string") {
      normalized.viewed_files = JSON.parse(normalized.viewed_files);
    }
    return normalized as PendingReview;
  });

export const savePendingReview = (
  repoPath: string,
  workspaceId: number,
  comments: LineComment[],
  viewedFiles?: string[],
  summaryText?: string,
): Promise<number> =>
  invoke("save_pending_review", {
    repoPath,
    workspaceId,
    comments: JSON.stringify(comments),
    viewedFiles: viewedFiles ? JSON.stringify(viewedFiles) : null,
    summaryText: summaryText ?? null,
  });

export const clearPendingReview = (
  repoPath: string,
  workspaceId: number,
): Promise<void> => invoke("clear_pending_review", { repoPath, workspaceId });

export const loadFileBrowserReview = (
  repoPath: string,
  workspaceId: number,
): Promise<FileBrowserPendingReview | null> =>
  invoke("load_file_browser_review", { repoPath, workspaceId }).then(
    (review) => {
      if (!review) return null;
      const normalized = { ...review } as FileBrowserPendingReview & {
        comments: unknown;
      };
      if (typeof normalized.comments === "string") {
        normalized.comments = JSON.parse(normalized.comments);
      }
      return normalized as FileBrowserPendingReview;
    },
  );

export const saveFileBrowserReview = (
  repoPath: string,
  workspaceId: number,
  comments: LineComment[],
  summaryText?: string,
): Promise<number> =>
  invoke("save_file_browser_review", {
    repoPath,
    workspaceId,
    comments: JSON.stringify(comments),
    summaryText: summaryText ?? null,
  });

export const clearFileBrowserReview = (
  repoPath: string,
  workspaceId: number,
): Promise<void> =>
  invoke("clear_file_browser_review", { repoPath, workspaceId });

// File Watcher API
export const startFileWatcher = (
  workspaceId: number,
  workspacePath: string,
): Promise<void> =>
  invoke("start_file_watcher", { workspaceId, workspacePath });

export const stopFileWatcher = (
  workspaceId: number,
  workspacePath: string,
): Promise<void> => invoke("stop_file_watcher", { workspaceId, workspacePath });

// Wrapper required by local/require-tauri-api-command-wrappers; moveCommitToExistingWorkspace
// is not yet called from the UI.
export const moveCommitToExistingWorkspace = (
  repoPath: string,
  sourceWorkspaceId: number,
  commitChangeId: string,
  targetWorkspaceId: number,
): Promise<void> =>
  invoke("move_commit_to_existing_workspace", {
    repoPath,
    sourceWorkspaceId,
    commitChangeId,
    targetWorkspaceId,
  });

export const abandonCommit = (
  repoPath: string,
  workspaceId: number,
  commitChangeId: string,
): Promise<string> =>
  invoke("abandon_commit", {
    repoPath,
    workspaceId,
    commitChangeId,
  });

export const undoRepoOperation = (
  repoPath: string,
  workspaceId: number | null,
  operationId: string,
): Promise<string> =>
  invoke("undo_repo_operation", {
    repoPath,
    workspaceId,
    operationId,
  });

export const getCommitDescription = (
  repoPath: string,
  workspaceId: number,
  commitChangeId: string,
): Promise<string> =>
  invoke("get_commit_description", {
    repoPath,
    workspaceId,
    commitChangeId,
  });

export const describeCommit = (
  repoPath: string,
  workspaceId: number,
  commitChangeId: string,
  description: string,
): Promise<void> =>
  invoke("describe_commit", {
    repoPath,
    workspaceId,
    commitChangeId,
    description,
  });

export const shiftCommitTimestamp = (
  repoPath: string,
  workspaceId: number,
  commitChangeId: string,
  shift: {
    days?: number;
    hours?: number;
    minutes?: number;
    toDay?: string | null;
  },
): Promise<void> =>
  invoke("shift_commit_timestamp", {
    repoPath,
    workspaceId,
    commitChangeId,
    days: shift.days ?? 0,
    hours: shift.hours ?? 0,
    minutes: shift.minutes ?? 0,
    toDay: shift.toDay ?? null,
  });

export const shiftMutableCommitsToNow = (
  repoPath: string,
  workspaceId: number,
): Promise<void> =>
  invoke("shift_mutable_commits_to_now", {
    repoPath,
    workspaceId,
  });

export const getTreqBinDir = (): Promise<string> => invoke("get_treq_bin_dir");

/**
 * Force-fetch PR info via `gh pr view` and warm the Rust cache.
 * Prefer cache reads (`getCachedPrInfo` / `listCachedPrStatuses`) for UI
 * polling; use this only after mutations that need an immediate refresh.
 */
export const getPrInfoViaGh = (
  repoPath: string,
  branchName: string,
): Promise<PrInfo | null> =>
  invoke("get_pr_info_via_gh", { repoPath, branchName });

/** Start Rust-side background PR-status polling for a repo's workspaces. */
export const startPrStatusPolling = (repoPath: string): Promise<void> =>
  invoke("start_pr_status_polling", { repoPath });

/** Stop Rust-side background PR-status polling for a repo. */
export const stopPrStatusPolling = (repoPath: string): Promise<void> =>
  invoke("stop_pr_status_polling", { repoPath });

/**
 * Cached PR statuses (`branch -> PrInfo | null`) maintained by the Rust
 * background poller. Never shells out to `gh` from the UI thread.
 */
export const listCachedPrStatuses = (
  repoPath: string,
): Promise<Record<string, PrInfo | null>> =>
  invoke("list_cached_pr_statuses", { repoPath });

/** Single-branch read from the Rust PR-status cache (no `gh` call). */
export const getCachedPrInfo = (
  repoPath: string,
  branchName: string,
): Promise<PrInfo | null> =>
  invoke("get_cached_pr_info", { repoPath, branchName });

/**
 * Cached CI rollups (`branch -> PrCiStatus | null`) from the Rust background
 * poller. Never shells out to `gh` from the UI thread.
 */
export const listCachedPrCiStatuses = (
  repoPath: string,
): Promise<Record<string, PrCiStatus | null>> =>
  invoke("list_cached_pr_ci_statuses", { repoPath });

/** Single-branch CI read from the Rust cache (no `gh` call). */
export const getCachedPrCiStatus = (
  repoPath: string,
  branchName: string,
): Promise<PrCiStatus | null> =>
  invoke("get_cached_pr_ci_status", { repoPath, branchName });

/** Force a full-repo cache refresh (e.g. after bulk workspace changes). */
export const refreshPrStatuses = (repoPath: string): Promise<void> =>
  invoke("refresh_pr_statuses", { repoPath });

/**
 * Queue an out-of-band PR+CI refresh for one branch. Returns immediately;
 * the Rust background worker updates the cache and emits
 * `pr-statuses-updated` when done. Call when opening a workspace so the
 * UI does not wait for the next poll tick.
 */
export const refreshPrBranchStatus = (
  repoPath: string,
  branchName: string,
): Promise<void> =>
  invoke("refresh_pr_branch_status", { repoPath, branchName });

export type OpenOrCreateWorkspaceFromPrResult = {
  workspaceId: number;
  created: boolean;
};

/** Open or create a workspace for a GitHub PR head branch (base becomes target). */
export const openOrCreateWorkspaceFromPr = (
  repoPath: string,
  headBranch: string,
  baseBranch: string,
  title?: string,
  description?: string,
): Promise<OpenOrCreateWorkspaceFromPrResult> =>
  invoke("open_or_create_workspace_from_pr", {
    repoPath,
    headBranch,
    baseBranch,
    title: title ?? null,
    description: description ?? null,
  });

export type AppUpdateCheckResult = {
  supported: boolean;
  available: boolean;
  currentVersion: string;
  latestVersion: string | null;
  downloadUrl: string | null;
};

/** Compare the running build against https://treq.dev/version (Mac install only). */
export const checkForAppUpdate = (): Promise<AppUpdateCheckResult> =>
  invoke("check_for_app_update");

/**
 * Download + replace the macOS .app bundle, then relaunch.
 * Rejects on non-macOS builds.
 */
export const installAppUpdate = (downloadUrl: string): Promise<void> =>
  invoke("install_app_update", { downloadUrl });

/** Settings parsed from a repository's `.treq/config.yaml`, if present. */
export interface RepoYamlConfig {
  branch_name_pattern: string | null;
  default_model: string | null;
  default_agent: string | null;
  target_branch: string | null;
  included_copy_files: string[] | null;
}
