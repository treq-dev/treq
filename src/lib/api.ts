import type {
	BranchStatus,
	BookmarkConflictResolutionResult,
	DirectoryEntry,
	EditorAppsResponse,
	GhIssue,
	GhListPage,
	GhPullRequest,
	GhReviewThread,
	GitRemoteInfo,
	PrCiStatus,
	HomeRebaseDryRunResult,
	JjBranch,
	JjCommitsAhead,
	JjDiffHunk,
	JjFileChange,
	JjFileDiff,
	JjFileLines,
	JjLogResult,
	JjRebaseResult,
	JjRevisionDiff,
	MergeStrategy,
	PullWorkspaceResult,
	RepoBranch,
	RenameWorkspaceResult,
	SingleRebaseResult,
	Workspace,
	WorkspaceSidebarStatus,
	WorkspaceStatus,
} from "./api-types";

import { invoke } from "@tauri-apps/api/core";

export * from "./api-extra";
export * from "./api-types";

export const initRepo = (repoPath: string): Promise<void> =>
	invoke("init_repo", { repoPath });

// Database API
export const getWorkspaces = (repoPath: string): Promise<Workspace[]> =>
	invoke("get_workspaces", { repoPath });

export const getRepoCurrentBranch = (repoPath: string): Promise<RepoBranch> =>
	invoke("get_repo_current_branch", { repoPath });

export const getRepoDefaultBranch = (repoPath: string): Promise<string> =>
	invoke("get_repo_default_branch", { repoPath });

export const createWorkspace = (
	repoPath: string,
	branchName: string,
	sourceBranch?: string,
	metadata?: string,
): Promise<number> =>
	invoke("create_workspace", {
		repoPath,
		branchName,
		sourceBranch: sourceBranch ?? null,
		metadata: metadata ?? null,
	});

export const deleteWorkspace = (repoPath: string, id: number): Promise<void> =>
	invoke("delete_workspace", {
		repoPath,
		id,
	});

export const ensureWorkspaceIndexed = (
	repoPath: string,
	workspaceId: number | null,
	workspacePath: string,
): Promise<boolean> =>
	invoke("ensure_workspace_indexed", {
		repoPath,
		workspaceId,
		workspacePath,
	});

export const getSetting = (key: string): Promise<string | null> =>
	invoke("get_setting", { key });

export const getSettingsBatch = (
	keys: string[],
): Promise<Record<string, string | null>> =>
	invoke("get_settings_batch", { keys });

export const setSetting = (key: string, value: string): Promise<void> =>
	invoke("set_setting", { key, value });

export const getRepoSetting = (
	repoPath: string,
	key: string,
): Promise<string | null> => invoke("get_repo_setting", { repoPath, key });

export const setRepoSetting = (
	repoPath: string,
	key: string,
	value: string,
): Promise<void> => invoke("set_repo_setting", { repoPath, key, value });

export const setWindowRepoPath = (repoPath: string): Promise<void> =>
	invoke("set_window_repo_path", { repoPath });

export const getWindowRepoPath = (): Promise<string | null> =>
	invoke("get_window_repo_path");

export const detectEditorApps = (): Promise<EditorAppsResponse> =>
	invoke("detect_editor_apps");

export const getGitRemoteUrl = (
	repoPath: string,
): Promise<GitRemoteInfo | null> => invoke("get_git_remote_url", { repoPath });

export const getPrChecksViaGh = (
	repoPath: string,
	branchName: string,
): Promise<PrCiStatus | null> =>
	invoke("get_pr_checks_via_gh", { repoPath, branchName });

export const getPrChecksForPr = (
	repoFullName: string,
	prNumber: number,
): Promise<PrCiStatus | null> =>
	invoke("get_pr_checks_for_pr", { repoFullName, prNumber });

// JJ Workspace API
// JJ Diff API
export const getWorkspaceChangedFiles = (
	repoPath: string,
	workspaceId: number | null,
): Promise<JjFileChange[]> =>
	invoke("get_workspace_changed_files", { repoPath, workspaceId });

export const lsWorkspace = (
	repoPath: string,
	workspaceId: number | null,
): Promise<DirectoryEntry[]> =>
	invoke("ls_workspace", { repoPath, workspaceId });

export const getWorkspaceReadme = (
	repoPath: string,
	workspaceId: number | null,
): Promise<string | null> =>
	invoke("get_workspace_readme", { repoPath, workspaceId });

export const getWorkspaceFileHunks = (
	repoPath: string,
	workspaceId: number | null,
	filePath: string,
): Promise<JjDiffHunk[]> =>
	invoke("get_workspace_file_hunks", {
		repoPath,
		workspaceId,
		filePath,
	});

export const getWorkspaceFileLines = (
	repoPath: string,
	workspaceId: number | null,
	filePath: string,
	fromParent: boolean,
	startLine: number,
	endLine: number,
): Promise<JjFileLines> =>
	invoke("get_workspace_file_lines", {
		repoPath,
		workspaceId,
		filePath,
		fromParent,
		startLine,
		endLine,
	});

export const jjRestoreFile = (
	workspacePath: string,
	filePath: string,
): Promise<string> =>
	invoke("discard_workspace_file", {
		workspacePath,
		filePath,
	});

export const jjRestoreAll = (workspacePath: string): Promise<string> =>
	invoke("discard_workspace_changes", { workspacePath });

export const jjSnapshotWorkingCopy = (workspacePath: string): Promise<string> =>
	invoke("snapshot_working_copy", { workspacePath });

export const jjRestoreSnapshot = (
	workspacePath: string,
	snapshotId: string,
): Promise<string> =>
	invoke("restore_working_copy_snapshot", { workspacePath, snapshotId });

export const discardWorkspaceChanges = (
	workspacePath: string,
): Promise<string> => invoke("discard_workspace_changes", { workspacePath });

export const discardWorkspaceFile = (
	workspacePath: string,
	filePath: string,
): Promise<string> =>
	invoke("discard_workspace_file", { workspacePath, filePath });

export const createCommit = (
	repoPath: string,
	workspaceId: number | null,
	message: string,
): Promise<string> =>
	invoke("create_commit", {
		repoPath,
		workspaceId,
		message,
	});

export const listCommits = (
	repoPath: string,
	workspaceId: number | null,
	includeTargetBranchHistory?: boolean,
	targetBranchLimit?: number,
	limit?: number,
): Promise<JjLogResult> =>
	invoke("list_commits", {
		repoPath,
		workspaceId,
		includeTargetBranchHistory: includeTargetBranchHistory ?? false,
		targetBranchLimit: targetBranchLimit ?? null,
		limit: limit ?? null,
	});

export const jjSplit = (
	workspacePath: string,
	message: string,
	filePaths: string[],
): Promise<string> =>
	invoke("jj_split", {
		workspacePath,
		message,
		filePaths,
	});

export const listRepoBranches = (repoPath: string): Promise<JjBranch[]> =>
	invoke("list_repo_branches", { repoPath });

export const switchRepoBranch = (
	repoPath: string,
	bookmarkName: string,
): Promise<string> =>
	invoke("switch_repo_branch", {
		repoPath,
		bookmarkName,
	});

export interface SyncStatus {
	ahead: number;
	behind: number;
}

export const jjGitFetchBackground = (repoPath: string): Promise<void> =>
	invoke("jj_git_fetch_background", { repoPath });

export const pullWorkspaceFromRemote = (
	repoPath: string,
	workspaceId: number | null,
): Promise<PullWorkspaceResult> =>
	invoke("pull_workspace_from_remote", {
		repoPath,
		workspaceId,
	});

export const checkBranchExists = (
	repoPath: string,
	branchName: string,
): Promise<BranchStatus> =>
	invoke("jj_check_branch_exists", {
		repoPath,
		branchName,
	});

export const getCommitDiff = (
	repoPath: string,
	workspaceId: number | null,
	revision: string,
): Promise<JjRevisionDiff> =>
	invoke("get_commit_diff", { repoPath, workspaceId, revision });

export const getCommitFileDiff = (
	repoPath: string,
	workspaceId: number | null,
	revision: string,
	filePath: string,
): Promise<JjFileDiff> =>
	invoke("get_commit_file_diff", {
		repoPath,
		workspaceId,
		revision,
		filePath,
	});

export const jjGetCommitsAhead = (
	workspacePath: string,
	targetBranch: string,
): Promise<JjCommitsAhead> =>
	invoke("jj_get_commits_ahead", { workspacePath, targetBranch });

export const getWorkspaceDiff = (
	repoPath: string,
	workspaceId: number,
): Promise<JjRevisionDiff> =>
	invoke("get_workspace_diff", { repoPath, workspaceId });

export interface HunkSpec {
	file_path: string;
	start_line: number;
	end_line: number;
}

export interface WorkspaceMoveRequest {
	files: string[];
	hunks: HunkSpec[];
	commits: string[];
}

export interface WorkspaceMoveResult {
	commits_moved: number;
	files_moved: number;
	hunks_applied: number;
	hunks_skipped: number;
	warnings: string[];
}

export const moveWorkspaceChanges = (
	repoPath: string,
	sourceBranch: string,
	destinationBranch: string,
	request: WorkspaceMoveRequest,
): Promise<WorkspaceMoveResult> =>
	invoke("move_workspace_changes", {
		repoPath,
		sourceBranch,
		destinationBranch,
		request,
	});

export const renameWorkspace = (
	repoPath: string,
	workspaceId: number,
	newBranchName: string,
	dryRun: boolean,
): Promise<RenameWorkspaceResult> =>
	invoke("rename_workspace", {
		repoPath,
		workspaceId,
		newBranchName,
		dryRun,
	});

export const mergeWorkspace = (
	repoPath: string,
	workspaceId: number,
	message: string,
	mergeStrategy: MergeStrategy,
): Promise<void> =>
	invoke("merge_workspace", {
		repoPath,
		workspaceId,
		message,
		mergeStrategy,
	});

export const pushWorkspaceToRemote = (
	repoPath: string,
	workspaceId: number | null,
): Promise<string> =>
	invoke("push_workspace_to_remote", {
		repoPath,
		workspaceId,
	});

export const listWorkspaceStatuses = (
	repoPath: string,
): Promise<WorkspaceSidebarStatus[]> =>
	invoke("list_workspace_statuses", {
		repoPath,
	});

export const getWorkspaceStatus = (
	repoPath: string,
	workspaceId: number | null,
): Promise<WorkspaceStatus> =>
	invoke("get_workspace_status", {
		repoPath,
		workspaceId,
	});

export const updateWorkspace = (
	repoPath: string,
	workspaceId: number,
	targetBranch?: string,
	title?: string,
	description?: string,
): Promise<Workspace> =>
	invoke("update_workspace", {
		repoPath,
		workspaceId,
		...(targetBranch !== undefined && { targetBranch }),
		...(title !== undefined && { title }),
		...(description !== undefined && { description }),
	});

export const setWorkspaceTargetBranch = (
	repoPath: string,
	workspacePath: string,
	id: number,
	targetBranch: string,
): Promise<JjRebaseResult> =>
	invoke("set_workspace_target_branch", {
		repoPath,
		workspacePath,
		id,
		targetBranch,
	});

// Kept for compatibility with existing mocks/consumers while unused in app runtime.
// Intentionally left empty.

export const checkAndRebaseWorkspaces = (
	repoPath: string,
	workspaceId?: number | null,
	defaultBranch?: string | null,
	force?: boolean,
): Promise<SingleRebaseResult> =>
	invoke("check_and_rebase_workspaces", {
		repoPath,
		workspaceId: workspaceId ?? null,
		defaultBranch: defaultBranch ?? null,
		force: force ?? null,
	});

export const resolveBookmarkConflict = (
	repoPath: string,
	workspaceId: number,
	workspacePath: string,
	branchName: string,
): Promise<BookmarkConflictResolutionResult> =>
	invoke("resolve_workspace_bookmark_conflict", {
		repoPath,
		workspaceId,
		workspacePath,
		branchName,
	});

export const rebaseHomeRepoBranch = (
	repoPath: string,
	currentBranch: string,
	targetBranch: string,
): Promise<JjRebaseResult> =>
	invoke("rebase_home_repo_branch", {
		repoPath,
		currentBranch,
		targetBranch,
	});

export const dryRunHomeRepoRebase = (
	repoPath: string,
	currentBranch: string,
	targetBranch: string,
): Promise<HomeRebaseDryRunResult> =>
	invoke("dry_run_home_repo_rebase", {
		repoPath,
		currentBranch,
		targetBranch,
	});

// GitHub CLI API
export const GH_LIST_PAGE_SIZE = 30;

export const ghListIssues = (
	repoFullName: string,
	state: string,
	limit = GH_LIST_PAGE_SIZE,
	page = 1,
): Promise<GhListPage<GhIssue>> =>
	invoke("gh_list_issues", { repoFullName, state, limit, page });

export const ghViewIssue = (
	repoFullName: string,
	issueNumber: number,
): Promise<GhIssue> => invoke("gh_view_issue", { repoFullName, issueNumber });

export const ghCreateIssue = (
	repoFullName: string,
	title: string,
	body: string,
): Promise<number> => invoke("gh_create_issue", { repoFullName, title, body });

export const ghCreateIssueComment = (
	repoFullName: string,
	issueNumber: number,
	body: string,
): Promise<void> =>
	invoke("gh_create_issue_comment", { repoFullName, issueNumber, body });

export const ghCloseIssue = (
	repoFullName: string,
	issueNumber: number,
): Promise<void> => invoke("gh_close_issue", { repoFullName, issueNumber });

export const ghReopenIssue = (
	repoFullName: string,
	issueNumber: number,
): Promise<void> => invoke("gh_reopen_issue", { repoFullName, issueNumber });

export const ghListPrs = (
	repoFullName: string,
	state: string,
	limit = GH_LIST_PAGE_SIZE,
	page = 1,
): Promise<GhListPage<GhPullRequest>> =>
	invoke("gh_list_prs", { repoFullName, state, limit, page });

export const ghViewPr = (
	repoFullName: string,
	prNumber: number,
): Promise<GhPullRequest> => invoke("gh_view_pr", { repoFullName, prNumber });

/** Read-only: lists PR review comment threads (with resolved/outdated state). */
export const ghListPrReviewThreads = (
	owner: string,
	repo: string,
	prNumber: number,
): Promise<GhReviewThread[]> =>
	invoke("gh_list_pr_review_threads", { owner, repo, prNumber });

export const ghCreatePrComment = (
	repoFullName: string,
	prNumber: number,
	body: string,
): Promise<void> =>
	invoke("gh_create_pr_comment", { repoFullName, prNumber, body });

export const ghClosePr = (
	repoFullName: string,
	prNumber: number,
): Promise<void> => invoke("gh_close_pr", { repoFullName, prNumber });

export const ghReopenPr = (
	repoFullName: string,
	prNumber: number,
): Promise<void> => invoke("gh_reopen_pr", { repoFullName, prNumber });

export const ghSetPrDraft = (
	repoFullName: string,
	prNumber: number,
	draft: boolean,
): Promise<void> =>
	invoke("gh_set_pr_draft", { repoFullName, prNumber, draft });

export const ghCreatePr = (
	repoFullName: string,
	title: string,
	body: string,
	baseBranch: string,
	headBranch: string,
	draft = false,
): Promise<number> =>
	invoke("gh_create_pr", {
		repoFullName,
		title,
		body,
		baseBranch,
		headBranch,
		draft,
	});

// PTY API
