import type {
	CachedDirectoryEntry,
	DiffCacheEntry,
	DirectoryEntry,
	FileSearchResult,
	LineComment,
	PendingReview,
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
	remoteHost?: string,
): Promise<void> =>
	invoke("pty_create_session", {
		sessionId,
		workingDir,
		shell,
		initialCommand,
		suppressEchoFor,
		remoteHost: remoteHost ?? null,
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

export const getTreqBinDir = (): Promise<string> => invoke("get_treq_bin_dir");
