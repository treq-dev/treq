import type {
	ConflictRegion,
	GhReviewThread,
	JjDiffHunk,
	JjFileChange,
	LineComment as ApiLineComment,
} from "../../lib/api";
import type { Workspace } from "../../lib/api-types";
import type { ParsedFileChange } from "../../lib/git-utils";
import {
	FILE_COMMENT_HUNK_ID,
	type LineComment,
	type PendingComment,
} from "../../lib/review";
import type { useToast } from "../ui/toast";

export { FILE_COMMENT_HUNK_ID };
export type { LineComment, PendingComment };

export interface ChangesDiffViewerProps {
	workspacePath: string;
	repoPath?: string;
	workspaceId?: number;
	branchName?: string;
	readOnly?: boolean;
	onStagedFilesChange?: (files: string[]) => void;
	onChangedFilesChange?: (files: ParsedFileChange[]) => void;
	onRefreshingChange?: (isRefreshing: boolean) => void;
	initialSelectedFile: string | null;
	onReviewSubmitted?: () => void;
	onCreateAgentWithReview?: (
		reviewMarkdown: string,
		mode: "plan" | "acceptEdits",
	) => Promise<void>;
	conflictedFiles?: string[];
	showCommittedChanges?: boolean;
	onMoveFilesToNewWorkspace?: (files: string[]) => void;
	workspace?: Workspace | null;
	baseBranch?: string;
}

export interface ChangesDiffViewerHandle {
	focusCommitInput: () => void;
	refresh: () => void;
}

export interface ConflictComment {
	id: string;
	conflictId: string;
	filePath: string;
	conflictNumber: number;
	text: string;
	createdAt: string;
}

export interface DiffLineSelection {
	filePath: string;
	lines: Array<{
		hunkIndex: number;
		lineIndex: number;
		content: string;
		isStaged: boolean;
	}>;
}

export interface FileHunksData {
	filePath: string;
	hunks: JjDiffHunk[];
	isLoading: boolean;
	error?: string;
}

export interface DiffSearchData {
	matches: Array<{
		filePath: string;
		hunkIndex: number;
		lineIndex: number;
		matchIndexInLine: number;
	}>;
	matchesByKey: Map<string, { firstGlobalIndex: number; count: number }>;
}

export interface CommentLineQuery {
	filePath: string;
	hunkId: string;
	lineNumber: number;
	side: "old" | "new";
}

export interface DiffLinePointer {
	filePath: string;
	hunkIndex: number;
	lineIndex: number;
}

export interface LineMouseDownPayload extends DiffLinePointer {
	event: React.MouseEvent;
	lineContent: string;
	isStaged: boolean;
}

export interface CommitInputHandle {
	focus: () => void;
}

export type CommitAction = "commit" | "push" | "pr";

export interface CommitInputProps {
	onCommit: (message: string) => void;
	onCommitAndPush: (message: string) => void;
	onCommitAndCreatePR: (message: string) => void;
	disabled: boolean;
	pending: boolean;
	pendingAction?: CommitAction | null;
	canCreatePr?: boolean;
	hasPr?: boolean;
	selectedFileCount?: number;
	totalFileCount?: number;
	workspacePath: string;
}

export interface HighlightedLineProps {
	content: string;
	language: string | null;
	searchQuery?: string;
	searchHighlightOffset?: number;
}

export interface FileRowComponentProps {
	file: ParsedFileChange;
	allFileHunks: Map<string, FileHunksData>;
	overrideFileHunks?: Map<string, FileHunksData>;
	collapsedFiles: Set<string>;
	viewedFiles: Map<string, { viewedAt: string; contentHash: string }>;
	expandedLargeDiffs: Set<string>;
	diffFontSize: number;
	readOnly: boolean;
	fileActionTarget: string | null;
	selectedUnstagedFiles: Set<string>;
	actualConflictedFiles: string[];
	workspacePath: string;
	toggleFileCollapse: (filePath: string) => void;
	toggleLargeDiff: (filePath: string) => void;
	handleMarkFileViewed: (filePath: string) => void;
	handleUnmarkFileViewed: (filePath: string) => void;
	handleDiscardFiles: (filePath: string) => void;
	handleContextMenu: (e: React.MouseEvent) => void;
	renderHunkLines: (
		hunk: JjDiffHunk,
		hunkIndex: number,
		filePath: string,
	) => JSX.Element;
	addToast: ReturnType<typeof useToast>["addToast"];
	getOutdatedCommentsForFile: (filePath: string) => LineComment[];
	getFileCommentsForFile: (filePath: string) => LineComment[];
	deleteComment: (commentId: string) => void;
	getThreadsForLine: (query: CommentLineQuery) => GhReviewThread[];
	getUnplacedThreadsForFile: (filePath: string) => GhReviewThread[];
	collapsedThreadIds: Set<string>;
	toggleThreadCollapse: (threadId: string) => void;
	expandedOutdatedGroups: Set<string>;
	toggleOutdatedGroup: (filePath: string) => void;
	showCommentInput: boolean;
	pendingComment: PendingComment | null;
	editingCommentId: string | null;
	setPendingComment: React.Dispatch<
		React.SetStateAction<PendingComment | null>
	>;
	setShowCommentInput: React.Dispatch<React.SetStateAction<boolean>>;
	addComment: (text: string) => void;
	cancelComment: () => void;
	startEditComment: (commentId: string) => void;
	cancelEditComment: () => void;
	saveEditComment: (commentId: string, text: string) => void;
}

export type { ApiLineComment, JjFileChange };

export interface HunkLinesProps {
	hunk: JjDiffHunk;
	hunkIndex: number;
	filePath: string;
	conflictedFilePaths: Set<string>;
	conflictLineLookups: Map<string, Map<number, ConflictRegion>>;
	firstConflictRegionIdByFile: Map<string, string>;
	expandedContext: Map<string, string[]>;
	conflictComments: Map<string, ConflictComment>;
	openConflictComments: Set<string>;
	editingConflictCommentId: string | null;
	searchData: DiffSearchData;
	debouncedSearchQuery: string;
	currentMatchIndex: number;
	diffLineSelection: DiffLineSelection | null;
	showCommentInput: boolean;
	pendingComment: PendingComment | null;
	editingCommentId: string | null;
	comments: LineComment[];
	conflictFileRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
	diffFontSize: number;
	handleExpandContext: (
		filePath: string,
		hunkIndex: number,
		direction: "before" | "after",
	) => void;
	handleLineMouseDown: (payload: LineMouseDownPayload) => void;
	handleLineMouseEnter: (line: DiffLinePointer) => void;
	handleLineMouseUp: () => void;
	handleAddCommentFromSelection: () => void;
	isLineSelected: (line: DiffLinePointer) => boolean;
	saveConflictComment: (args: {
		conflictId: string;
		filePath: string;
		conflictNumber: number;
		text: string;
	}) => void;
	clearConflictComment: (conflictId: string) => void;
	toggleConflictComment: (conflictId: string) => void;
	setOpenConflictComments: React.Dispatch<React.SetStateAction<Set<string>>>;
	startEditConflictComment: (commentId: string) => void;
	cancelEditConflictComment: () => void;
	saveEditConflictComment: (commentId: string, text: string) => void;
	addComment: (text: string) => void;
	cancelComment: () => void;
	deleteComment: (commentId: string) => void;
	startEditComment: (commentId: string) => void;
	cancelEditComment: () => void;
	saveEditComment: (commentId: string, text: string) => void;
	setPendingComment: React.Dispatch<
		React.SetStateAction<PendingComment | null>
	>;
	setShowCommentInput: React.Dispatch<React.SetStateAction<boolean>>;
	getCommentsForLine: (query: CommentLineQuery) => LineComment[];
	getThreadsForLine: (query: CommentLineQuery) => GhReviewThread[];
	collapsedThreadIds: Set<string>;
	toggleThreadCollapse: (threadId: string) => void;
}
