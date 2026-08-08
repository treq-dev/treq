import type {
	CachedDirectoryEntry,
	DiffCacheEntry,
	DirectoryEntry,
	FileSearchResult,
	LineComment,
	PendingReview,
	PrCiStatus,
	PrInfo,
	Session,
} from "./api-types";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

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

export const getFileModifiedAt = (path: string): Promise<string | null> =>
	invoke("get_file_modified_at", { path });

export const listDirectory = (path: string): Promise<DirectoryEntry[]> =>
	invoke("list_directory", { path });

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
): Promise<void> =>
	invoke("abandon_commit", {
		repoPath,
		workspaceId,
		commitChangeId,
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
