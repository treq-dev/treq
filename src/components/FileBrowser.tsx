/* eslint-disable max-lines, max-nested-callbacks */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	AlertCircle,
	Check,
	ChevronLeft,
	Code2,
	Copy,
	Eye,
	FileText,
	Folder,
	FolderOpen,
	Loader2,
	MessageSquare,
	Plus,
	Send,
	X,
} from "lucide-react";
import { List, type ListImperativeAPI } from "react-window";
import {
	type DirectoryEntry,
	type Workspace,
	ensureWorkspaceIndexed,
	getFileModifiedAt,
	getWorkspaceChangedFiles,
	getWorkspaceFileHunks,
	listDirectory,
	listDirectoryCached,
	readFile,
} from "../lib/api";
import {
	cn,
	formatFullTimestamp,
	formatRelativeTime,
	getFullWorkspacePath,
	resolveReadmeImageSrc,
} from "../lib/utils";
import { getLanguageFromPath, highlightCode } from "../lib/syntax-highlight";
import { useToast } from "./ui/toast";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "./ui/tooltip";
import {
	getFileStatusTextColor,
	getStatusBgColor,
} from "../lib/git-status-colors";
import { useTerminalSettings } from "../hooks/useTerminalSettings";
import { type ParsedFileChange, parseJjChangedFiles } from "../lib/git-utils";
import { useKeyboardShortcut } from "../hooks/useKeyboard";
import { useDebounce } from "../hooks/useDebounce";
import { SearchOverlay } from "./SearchOverlay";
import {
	type SearchMatch,
	findMatches,
	highlightInHtml,
} from "../lib/text-search";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuTrigger,
} from "./ui/context-menu";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useEditorApps } from "../hooks/useEditorApps";
import { useFileBrowserReview } from "../hooks/useFileBrowserReview";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { CommentInput } from "./CommentInput";
import { MarkdownContent } from "./MarkdownContent";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { Textarea } from "./ui/textarea";

// Helper to check if file is binary
function isBinaryFile(path: string): boolean {
	const binaryExtensions = [
		".png",
		".jpg",
		".jpeg",
		".gif",
		".bmp",
		".ico",
		".svg",
		".pdf",
		".zip",
		".tar",
		".gz",
		".rar",
		".7z",
		".exe",
		".dll",
		".so",
		".dylib",
		".mp3",
		".mp4",
		".avi",
		".mov",
		".wmv",
		".woff",
		".woff2",
		".ttf",
		".eot",
	];
	return binaryExtensions.some((ext) => path.toLowerCase().endsWith(ext));
}

interface LineSelection {
	startLine: number;
	endLine: number;
}

interface FileBrowserProps {
	workspace: Workspace | null;
	repoPath: string | null;
	initialSelectedFile: string | null;
	initialExpandedDir: string | null;
	onBack?: () => void;
	onCreateAgentWithReview?: (
		reviewMarkdown: string,
		mode: "plan" | "acceptEdits",
	) => Promise<void>;
}

/** Placeholder hunkId for FileBrowser comments — there's no jj diff hunk to anchor to. */
const FILE_BROWSER_COMMENT_HUNK_ID = "browser";

// Filter out .git and .treq files/directories (but keep .github, .gitignore, etc.)
function filterHiddenEntries(entries: DirectoryEntry[]): DirectoryEntry[] {
	return entries.filter((entry) => {
		const { name } = entry;
		return name !== ".git" && name !== ".treq";
	});
}

// Virtualization constants
const LINE_HEIGHT = 18;
const COMMENT_ROW_HEIGHT = 165;

// TreeNode component - memoized to prevent unnecessary re-renders
interface TreeNodeProps {
	entry: DirectoryEntry;
	depth: number;
	isExpanded: boolean;
	childEntries: DirectoryEntry[];
	hasChanges: boolean;
	selectedFile: string | null;
	changedFiles: Map<string, ParsedFileChange>;
	commentCounts: Map<string, number>;
	basePath: string;
	onDirectoryClick: (path: string) => void;
	onFileClick: (path: string) => void;
	getDirectoryChangeStatus: (path: string) => ParsedFileChange | undefined;
	renderChildren: (entry: DirectoryEntry, depth: number) => JSX.Element;
	getRelativePath: (fullPath: string) => string;
	addToast: ReturnType<typeof useToast>["addToast"];
}

// CodeLine component - memoized individual line to prevent re-renders
interface CodeLineProps {
	lineNum: number;
	htmlContent: string;
	diffStatus: "add" | "modify" | "delete" | undefined;
	hasDeletionMarker: boolean;
	lineNumberWidth: number;
	onMouseEnter: () => void;
	onMouseLeave: () => void;
	style: React.CSSProperties;
	fontSize: number;
	hoveredLine: number | null;
	isLineSelected: boolean;
	isSelecting: boolean;
	onLineMouseDown: (
		e: React.MouseEvent,
		lineNum: number,
		lineContent: string,
	) => void;
	onLineMouseEnter: (lineNum: number) => void;
	onLineMouseUp: () => void;
	onAddComment: (lineNum?: number) => void;
}

const CodeLine = memo(
	({
		lineNum,
		htmlContent,
		diffStatus,
		hasDeletionMarker,
		lineNumberWidth,
		onMouseEnter,
		onMouseLeave,
		style,
		fontSize,
		hoveredLine,
		isLineSelected,
		isSelecting,
		onLineMouseDown,
		onLineMouseEnter,
		onLineMouseUp,
		onAddComment,
	}: CodeLineProps) => (
		<div style={{ ...style, fontSize }}>
			<div
				data-testid="code-line"
				className={cn(
					"flex items-center group relative hover:bg-muted/30 transition-colors text-sm font-mono leading-normal",
					diffStatus === "add" && "bg-emerald-500/10",
					isLineSelected && "!bg-blue-500/20",
				)}
				style={{ height: LINE_HEIGHT }}
				onMouseEnter={onMouseEnter}
				onMouseLeave={onMouseLeave}
				onMouseDown={(e) => onLineMouseDown(e, lineNum, htmlContent)}
				onMouseMove={() => onLineMouseEnter(lineNum)}
				onMouseUp={onLineMouseUp}
			>
				{diffStatus && (
					<span
						className={cn(
							"absolute left-0 w-1 h-full",
							diffStatus === "add" && "bg-emerald-500",
							diffStatus === "modify" && "bg-yellow-500",
							diffStatus === "delete" && "bg-red-500",
						)}
					/>
				)}
				{/* Deletion marker - shown between lines where content was deleted */}
				{hasDeletionMarker && (
					<span
						className="absolute left-0 bottom-0 w-2 h-[3px] bg-red-500"
						style={{
							clipPath: "polygon(0 0, 100% 50%, 0 100%)",
							transform: "translateY(50%)",
						}}
						title="Lines deleted here"
					/>
				)}
				{/* Line number */}
				<span
					className="select-none text-muted-foreground/50 pr-2 text-right"
					style={{
						minWidth: `${lineNumberWidth}ch`,
						paddingLeft: diffStatus ? "4px" : "2px",
					}}
				>
					{lineNum}
				</span>
				{/* Comment button - appears on hover to the right of line numbers */}
				<span className="flex-shrink-0 w-5 h-5 -ml-4 flex items-center justify-center">
					{hoveredLine === lineNum && !isSelecting && (
						<button
							onMouseDown={(e) => {
								e.stopPropagation();
							}}
							onClick={(e) => {
								e.stopPropagation();
								onAddComment(lineNum);
							}}
							className="w-5 h-5 flex items-center justify-center rounded bg-blue-600 hover:bg-blue-700 text-white transition-colors"
							title="Add comment"
						>
							<Plus className="w-4 h-4" />
						</button>
					)}
				</span>
				{/* Code content */}
				<span
					data-testid="code-line-content"
					className="whitespace-pre-wrap break-words font-mono"
					dangerouslySetInnerHTML={{ __html: htmlContent }}
				/>
			</div>
		</div>
	),
);

// FileContentView component - memoized file content panel
interface FileContentViewProps {
	selectedFile: string | null;
	selectedFileModifiedAt: string | null;
	isLoadingFile: boolean;
	fileContent: string;
	fileContentData: {
		lines: string[];
		rawLines: string[];
		lineNumberWidth: number;
		language: string | null;
	} | null;
	basePath: string;
	fileHunks: Map<number, "add" | "modify" | "delete">;
	deletionMarkers: Set<number>;
	getItemHeight: (index: number) => number;
	onSetHoveredLine: (lineNum: number | null) => void;
	fontSize: number;
	hoveredLine: number | null;
	isSelecting: boolean;
	onLineMouseDown: (
		e: React.MouseEvent,
		lineNum: number,
		lineContent: string,
	) => void;
	onLineMouseEnter: (lineNum: number) => void;
	onLineMouseUp: () => void;
	isLineSelected: (lineNum: number) => boolean;
	onAddComment: (lineNum?: number) => void;
	showCommentInput: boolean;
	pendingComment: {
		startLine: number;
		endLine: number;
		lineContent: string[];
	} | null;
	onSubmitComment: (text: string) => void;
	onCancelComment: () => void;
	listRef: React.RefObject<ListImperativeAPI>;
	// Search props
	isSearchOpen: boolean;
	searchQuery: string;
	searchQueryDisplay: string;
	searchMatches: SearchMatch[];
	currentMatchIndex: number;
	onSearchQueryChange: (query: string) => void;
	onSearchNext: () => void;
	onSearchPrevious: () => void;
	onSearchClose: () => void;
	searchFocusTrigger: number;
}

const FileContentView = memo(
	({
		selectedFile,
		selectedFileModifiedAt,
		isLoadingFile,
		fileContent,
		fileContentData,
		basePath,
		fileHunks,
		deletionMarkers,
		getItemHeight,
		onSetHoveredLine,
		fontSize,
		hoveredLine,
		isSelecting,
		onLineMouseDown,
		onLineMouseEnter,
		onLineMouseUp,
		isLineSelected,
		onAddComment,
		showCommentInput,
		pendingComment,
		onSubmitComment,
		onCancelComment,
		listRef,
		isSearchOpen,
		searchQuery,
		searchQueryDisplay,
		searchMatches,
		currentMatchIndex,
		onSearchQueryChange,
		onSearchNext,
		onSearchPrevious,
		onSearchClose,
		searchFocusTrigger,
	}: FileContentViewProps) => {
		const [copied, setCopied] = useState(false);
		const [copiedPath, setCopiedPath] = useState(false);
		const [markdownView, setMarkdownView] = useState<{
			path: string;
			preview: boolean;
		} | null>(null);
		const isMarkdown = selectedFile
			? /\.(?:md|markdown)$/i.test(selectedFile)
			: false;
		const showMarkdownPreview =
			isMarkdown && markdownView?.path === selectedFile && markdownView.preview;

		const relativePath =
			selectedFile && basePath && selectedFile.startsWith(`${basePath}/`)
				? selectedFile.slice(basePath.length + 1)
				: selectedFile;
		const modifiedAgoLabel = selectedFileModifiedAt
			? `Modified ${formatRelativeTime(selectedFileModifiedAt)}`
			: null;
		const modifiedTimestampLabel = selectedFileModifiedAt
			? formatFullTimestamp(selectedFileModifiedAt)
			: null;

		const handleCopy = useCallback(async () => {
			if (!fileContentData) return;
			try {
				await navigator.clipboard.writeText(
					fileContentData.rawLines.join("\n"),
				);
				setCopied(true);
				setTimeout(() => setCopied(false), 2000);
			} catch (error) {
				console.error("Failed to copy:", error);
			}
		}, [fileContentData]);

		const handleCopyPath = useCallback(async () => {
			if (!relativePath) return;
			try {
				await navigator.clipboard.writeText(relativePath);
				setCopiedPath(true);
				setTimeout(() => setCopiedPath(false), 2000);
			} catch (error) {
				console.error("Failed to copy path:", error);
			}
		}, [relativePath]);

		if (!selectedFile) {
			return (
				<div className="flex items-center justify-center h-full text-muted-foreground">
					Select a file to view its contents
				</div>
			);
		}

		if (isBinaryFile(selectedFile)) {
			return (
				<div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
					<AlertCircle className="w-8 h-8" />
					<p>Binary file - cannot display</p>
					<p className="text-sm">{selectedFile.split("/").pop()}</p>
				</div>
			);
		}

		if (isLoadingFile) {
			return (
				<div className="flex items-center justify-center h-full">
					<Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
				</div>
			);
		}

		if (!fileContent || !fileContentData) {
			return (
				<div className="flex items-center justify-center h-full text-muted-foreground">
					Failed to load file content
				</div>
			);
		}

		const { lines, lineNumberWidth } = fileContentData;

		return (
			<div className="h-full flex flex-col bg-[hsl(var(--code-background))]">
				<TooltipProvider>
					<div className="px-4 pt-2 pb-2 border-b-[1px] border-solid border-zinc-700 flex items-center justify-between">
						<div className="flex items-center gap-3">
							<span className="text-sm text-muted-foreground font-mono">
								{relativePath}
							</span>
							<Tooltip>
								<TooltipTrigger asChild>
									<button
										type="button"
										onClick={handleCopyPath}
										className="p-1 hover:bg-muted rounded transition-colors text-muted-foreground hover:text-foreground"
									>
										{copiedPath ? (
											<Check className="w-4 h-4" />
										) : (
											<Copy className="w-4 h-4" />
										)}
									</button>
								</TooltipTrigger>
								<TooltipContent>
									<p>Copy file path</p>
								</TooltipContent>
							</Tooltip>
						</div>
						<div className="flex items-center gap-2">
							{modifiedAgoLabel && modifiedTimestampLabel && (
								<Tooltip>
									<TooltipTrigger asChild>
										<span className="text-sm text-muted-foreground/90 hover:text-muted-foreground cursor-default">
											{modifiedAgoLabel}
										</span>
									</TooltipTrigger>
									<TooltipContent>
										<p>{modifiedTimestampLabel}</p>
									</TooltipContent>
								</Tooltip>
							)}
							{isMarkdown && (
								<Tabs
									value={showMarkdownPreview ? "preview" : "code"}
									onValueChange={(value) =>
										setMarkdownView({
											path: selectedFile ?? "",
											preview: value === "preview",
										})
									}
								>
									<TabsList className="p-0.5 gap-0.5 text-xs">
										<TabsTrigger
											value="code"
											className="flex items-center gap-1 px-2 py-0.5"
										>
											<Code2 className="w-3.5 h-3.5" />
											Code
										</TabsTrigger>
										<TabsTrigger
											value="preview"
											className="flex items-center gap-1 px-2 py-0.5"
										>
											<Eye className="w-3.5 h-3.5" />
											Preview
										</TabsTrigger>
									</TabsList>
								</Tabs>
							)}
							<Tooltip>
								<TooltipTrigger asChild>
									<button
										type="button"
										onClick={handleCopy}
										className="p-1 hover:bg-muted rounded border border-border/50 transition-colors text-muted-foreground hover:text-foreground"
									>
										{copied ? (
											<Check className="w-4 h-4" />
										) : (
											<Copy className="w-4 h-4" />
										)}
									</button>
								</TooltipTrigger>
								<TooltipContent>
									<p>Copy file contents</p>
								</TooltipContent>
							</Tooltip>
						</div>
					</div>
				</TooltipProvider>
				<div className="flex-1 overflow-hidden relative">
					{isMarkdown && showMarkdownPreview ? (
						<div className="h-full overflow-auto bg-background px-8 py-6">
							<MarkdownContent
								content={fileContent}
								resolveImageSrc={(src) => {
									const separator = selectedFile.lastIndexOf("/");
									const markdownDir =
										separator >= 0
											? selectedFile.slice(0, separator)
											: basePath;
									return resolveReadmeImageSrc(src, markdownDir);
								}}
							/>
						</div>
					) : (
						<>
							<List
								listRef={listRef}
								rowCount={
									lines.length + (showCommentInput && pendingComment ? 1 : 0)
								}
								rowHeight={getItemHeight}
								rowComponent={({
									index,
									style,
								}: {
									index: number;
									style: React.CSSProperties;
								}) => {
									// Comment row is inserted at index = pendingComment.endLine (after last selected line)
									if (
										showCommentInput &&
										pendingComment &&
										index === pendingComment.endLine
									) {
										return (
											<div style={style}>
												<CommentInput
													onSubmit={onSubmitComment}
													onCancel={onCancelComment}
													filePath={relativePath ?? undefined}
													startLine={pendingComment.startLine}
													endLine={pendingComment.endLine}
												/>
											</div>
										);
									}

									// For rows after the comment row, adjust index to account for inserted row
									const lineIndex =
										showCommentInput &&
										pendingComment &&
										index > pendingComment.endLine
											? index - 1
											: index;
									const lineNum = lineIndex + 1;
									let line = lines[lineIndex];
									const diffStatus = fileHunks.get(lineNum);
									const hasDeletionMarker = deletionMarkers.has(lineNum);

									// Apply search highlighting if there's a query
									if (searchQuery) {
										// Find which global match index corresponds to this line
										const lineMatches = searchMatches.filter(
											(m) => m.lineNumber === lineIndex,
										);
										if (lineMatches.length > 0) {
											// Find global index of first match on this line
											const firstMatchGlobalIndex = searchMatches.findIndex(
												(m) => m.lineNumber === lineIndex,
											);
											const isCurrentMatchOnLine =
												searchMatches[currentMatchIndex]?.lineNumber ===
												lineIndex;
											const currentMatchOffset = isCurrentMatchOnLine
												? currentMatchIndex - firstMatchGlobalIndex
												: -1;

											const result = highlightInHtml(
												line,
												searchQuery,
												currentMatchOffset,
											);
											line = result.html;
										}
									}

									return (
										<CodeLine
											lineNum={lineNum}
											htmlContent={line}
											diffStatus={diffStatus}
											hasDeletionMarker={hasDeletionMarker}
											lineNumberWidth={lineNumberWidth}
											onMouseEnter={() => onSetHoveredLine(lineNum)}
											onMouseLeave={() => onSetHoveredLine(null)}
											style={style}
											fontSize={fontSize}
											hoveredLine={hoveredLine}
											isLineSelected={isLineSelected(lineNum)}
											isSelecting={isSelecting}
											onLineMouseDown={onLineMouseDown}
											onLineMouseEnter={onLineMouseEnter}
											onLineMouseUp={onLineMouseUp}
											onAddComment={onAddComment}
										/>
									);
								}}
								// eslint-disable-next-line @typescript-eslint/no-explicit-any
								rowProps={{} as any}
							/>
							{/* Search overlay */}
							<SearchOverlay
								isVisible={isSearchOpen}
								query={searchQueryDisplay}
								onQueryChange={onSearchQueryChange}
								onNext={onSearchNext}
								onPrevious={onSearchPrevious}
								onClose={onSearchClose}
								currentMatch={
									searchMatches.length > 0 ? currentMatchIndex + 1 : 0
								}
								totalMatches={searchMatches.length}
								className="absolute top-2 right-2 z-20"
								focusTrigger={searchFocusTrigger}
							/>
						</>
					)}
				</div>
			</div>
		);
	},
);

// FileTreeContextMenu component for file/directory context menu
const FileTreeContextMenu = memo(
	({
		entry,
		children,
		getRelativePath,
		addToast,
	}: {
		entry: DirectoryEntry;
		children: React.ReactNode;
		getRelativePath: (path: string) => string;
		addToast: ReturnType<typeof useToast>["addToast"];
	}) => {
		const editorApps = useEditorApps();

		return (
			<ContextMenu>
				<ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
				<ContextMenuContent>
					<ContextMenuItem
						data-testid="copy-relative-path"
						onClick={async () => {
							try {
								const relativePath = getRelativePath(entry.path);
								await navigator.clipboard.writeText(relativePath);
								addToast({
									title: "Copied",
									description: `Copied relative path: ${relativePath}`,
									type: "success",
								});
							} catch (err) {
								addToast({
									title: "Copy Failed",
									description: err instanceof Error ? err.message : String(err),
									type: "error",
								});
							}
						}}
					>
						<Copy className="w-4 h-4 mr-2" />
						Copy relative path
					</ContextMenuItem>

					<ContextMenuItem
						data-testid="copy-full-path"
						onClick={async () => {
							try {
								await navigator.clipboard.writeText(entry.path);
								addToast({
									title: "Copied",
									description: `Copied full path: ${entry.path}`,
									type: "success",
								});
							} catch (err) {
								addToast({
									title: "Copy Failed",
									description: err instanceof Error ? err.message : String(err),
									type: "error",
								});
							}
						}}
					>
						<Copy className="w-4 h-4 mr-2" />
						Copy full path
					</ContextMenuItem>

					<ContextMenuSeparator />

					<ContextMenuSub>
						<ContextMenuSubTrigger>
							<FolderOpen className="w-4 h-4 mr-2" />
							Open in...
						</ContextMenuSubTrigger>
						<ContextMenuSubContent>
							<ContextMenuItem
								onClick={async () => {
									try {
										await revealItemInDir(entry.path);
									} catch (err) {
										addToast({
											title: "Open Failed",
											description:
												err instanceof Error ? err.message : String(err),
											type: "error",
										});
									}
								}}
							>
								<FolderOpen className="w-4 h-4 mr-2" />
								Open in Finder
							</ContextMenuItem>

							{editorApps.cursor && (
								<ContextMenuItem
									onClick={async () => {
										try {
											await openUrl(`cursor://file/${entry.path}`);
										} catch (err) {
											addToast({
												title: "Open Failed",
												description:
													err instanceof Error ? err.message : String(err),
												type: "error",
											});
										}
									}}
								>
									Open in Cursor
								</ContextMenuItem>
							)}

							{editorApps.vscode && (
								<ContextMenuItem
									onClick={async () => {
										try {
											await openUrl(`vscode://file/${entry.path}`);
										} catch (err) {
											addToast({
												title: "Open Failed",
												description:
													err instanceof Error ? err.message : String(err),
												type: "error",
											});
										}
									}}
								>
									Open in VSCode
								</ContextMenuItem>
							)}

							{editorApps.zed && (
								<ContextMenuItem
									onClick={async () => {
										try {
											await openUrl(`zed://file/${entry.path}`);
										} catch (err) {
											addToast({
												title: "Open Failed",
												description:
													err instanceof Error ? err.message : String(err),
												type: "error",
											});
										}
									}}
								>
									Open in Zed
								</ContextMenuItem>
							)}
						</ContextMenuSubContent>
					</ContextMenuSub>
				</ContextMenuContent>
			</ContextMenu>
		);
	},
);

const TreeNode = memo(
	({
		entry,
		depth,
		isExpanded,
		childEntries: children,
		hasChanges,
		selectedFile,
		changedFiles,
		commentCounts,
		basePath,
		onDirectoryClick,
		onFileClick,
		getDirectoryChangeStatus,
		renderChildren,
		getRelativePath,
		addToast,
	}: TreeNodeProps) => {
		if (entry.is_directory) {
			return (
				<FileTreeContextMenu
					key={entry.path}
					entry={entry}
					getRelativePath={getRelativePath}
					addToast={addToast}
				>
					<div className="text-sm">
						<button
							type="button"
							className={cn(
								"flex items-center gap-2 w-full px-2 py-1 rounded-md hover:bg-muted/60 transition",
								"text-left",
							)}
							style={{ paddingLeft: `${depth * 16 + 8}px` }}
							onClick={() => onDirectoryClick(entry.path)}
						>
							{isExpanded ? (
								<FolderOpen className="w-4 h-4 flex-shrink-0" />
							) : (
								<Folder className="w-4 h-4 flex-shrink-0" />
							)}
							<span
								className={cn(
									"font-medium truncate font-mono text-sm",
									getFileStatusTextColor(
										getDirectoryChangeStatus(entry.path)?.workspaceStatus,
									),
								)}
							>
								{entry.name}
							</span>
							{hasChanges && (
								<span
									className="w-2 h-2 rounded-full flex-shrink-0 bg-yellow-500 ml-auto"
									title="Contains modified files"
								/>
							)}
						</button>
						{isExpanded && children.length > 0 && (
							<div>
								{children
									.sort((a, b) => {
										// Directories first, then alphabetically
										if (a.is_directory === b.is_directory) {
											return a.name.localeCompare(b.name);
										}
										return a.is_directory ? -1 : 1;
									})
									.map((child) => renderChildren(child, depth + 1))}
							</div>
						)}
						{isExpanded && children.length === 0 && (
							<div
								className="text-sm text-muted-foreground px-2 py-1"
								style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
							>
								Empty directory
							</div>
						)}
					</div>
				</FileTreeContextMenu>
			);
		}

		// File node - derive relative path for changedFiles lookup
		const relativePath = entry.path.startsWith(`${basePath}/`)
			? entry.path.slice(basePath.length + 1)
			: entry.path;
		const fileStatus = changedFiles.get(relativePath);
		const status = fileStatus?.workspaceStatus;
		const reviewCommentCount = commentCounts.get(relativePath) ?? 0;
		return (
			<FileTreeContextMenu
				key={entry.path}
				entry={entry}
				getRelativePath={getRelativePath}
				addToast={addToast}
			>
				<button
					type="button"
					onClick={() => onFileClick(entry.path)}
					className={cn(
						"w-full flex items-center gap-2 px-2 py-1 rounded-md text-sm transition",
						"hover:bg-muted/60 text-left",
						selectedFile === entry.path && "bg-primary/10",
					)}
					style={{ paddingLeft: `${depth * 16 + 8}px` }}
				>
					<FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
					<span
						className={cn(
							"truncate font-mono text-sm",
							getFileStatusTextColor(status),
						)}
					>
						{entry.name}
					</span>
					{reviewCommentCount > 0 && (
						<span
							className="flex items-center gap-0.5 text-[10px] text-primary flex-shrink-0 ml-auto"
							title={`${reviewCommentCount} pending review comment${reviewCommentCount !== 1 ? "s" : ""}`}
						>
							<MessageSquare className="w-3 h-3" />
							{reviewCommentCount}
						</span>
					)}
					{status && (
						<span
							className={cn(
								"w-2 h-2 rounded-full flex-shrink-0 ml-auto",
								getStatusBgColor(status),
							)}
							title={
								status === "M"
									? "Modified"
									: status === "A"
										? "Added"
										: status === "D"
											? "Deleted"
											: "Changed"
							}
						/>
					)}
				</button>
			</FileTreeContextMenu>
		);
	},
);

export const FileBrowser = memo(
	({
		workspace,
		repoPath,
		initialSelectedFile,
		initialExpandedDir,
		onBack,
		onCreateAgentWithReview,
	}: FileBrowserProps) => {
		// Determine the path and branch to use
		const basePath = workspace
			? getFullWorkspacePath(workspace)
			: (repoPath ?? "");

		const [expandedDirs, setExpandedDirs] = useState<Set<string>>(
			new Set([basePath]),
		);
		const [selectedFile, setSelectedFile] = useState<string | null>(null);
		const [selectedFileModifiedAt, setSelectedFileModifiedAt] = useState<
			string | null
		>(null);
		const [fileContent, setFileContent] = useState<string>("");
		const [directoryCache, setDirectoryCache] = useState<
			Map<string, DirectoryEntry[]>
		>(new Map());
		const [isLoadingFile, setIsLoadingFile] = useState(false);
		const [isLoadingDir, setIsLoadingDir] = useState(false);
		const [rootEntries, setRootEntries] = useState<DirectoryEntry[]>([]);
		const [changedFiles, setChangedFiles] = useState<
			Map<string, ParsedFileChange>
		>(new Map());
		const changedFilesRef = useRef(changedFiles);
		changedFilesRef.current = changedFiles;
		const [fileHunks, setFileHunks] = useState<
			Map<number, "add" | "modify" | "delete">
		>(new Map());
		const [deletionMarkers, setDeletionMarkers] = useState<Set<number>>(
			new Set(),
		);
		const [lineSelection, setLineSelection] = useState<LineSelection | null>(
			null,
		);
		const [isSelecting, setIsSelecting] = useState(false);
		const [selectionAnchor, setSelectionAnchor] = useState<number | null>(null);
		const [showCommentInput, setShowCommentInput] = useState(false);
		const [pendingComment, setPendingComment] = useState<{
			startLine: number;
			endLine: number;
			lineContent: string[];
		} | null>(null);
		const [hoveredLine, setHoveredLine] = useState<number | null>(null);
		const [isSearchOpen, setIsSearchOpen] = useState(false);
		const [searchQuery, setSearchQuery] = useState("");
		const debouncedSearchQuery = useDebounce(searchQuery, 150);
		const [searchFocusTrigger, setSearchFocusTrigger] = useState(0);
		const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
		const { addToast } = useToast();
		const { fontSize } = useTerminalSettings();
		const listRef = useRef<ListImperativeAPI>(null);
		const fileBrowserReview = useFileBrowserReview({
			repoPath,
			workspaceId: workspace?.id,
			onCreateAgentWithReview,
			addToast,
		});
		const commentCountsByFile = useMemo(() => {
			const counts = new Map<string, number>();
			for (const comment of fileBrowserReview.comments) {
				counts.set(comment.filePath, (counts.get(comment.filePath) ?? 0) + 1);
			}
			return counts;
		}, [fileBrowserReview.comments]);

		// Ensure workspace is indexed on mount
		useEffect(() => {
			if (repoPath) {
				const workspacePath = workspace
					? getFullWorkspacePath(workspace)
					: basePath;
				const workspaceId = workspace?.id ?? null;
				ensureWorkspaceIndexed(repoPath, workspaceId, workspacePath).catch(
					(error) => {
						console.error("Failed to ensure workspace indexed:", error);
					},
				);
			}
		}, [repoPath, workspace?.id, workspace?.workspace_path, basePath]);

		// Load root directory on mount
		useEffect(() => {
			setIsLoadingDir(true);
			listDirectory(basePath)
				.then((entries) => {
					const filtered = filterHiddenEntries(entries);
					setRootEntries(filtered);
					setDirectoryCache(new Map([[basePath, filtered]]));
				})
				.catch((error) => {
					addToast({
						title: "Failed to load directory",
						description: error instanceof Error ? error.message : String(error),
						type: "error",
					});
				})
				.finally(() => setIsLoadingDir(false));
		}, [basePath]);

		// Load changed files from JJ
		useEffect(() => {
			if (repoPath) {
				getWorkspaceChangedFiles(repoPath, workspace?.id ?? null)
					.then((jjFiles) => {
						const parsed = parseJjChangedFiles(jjFiles);
						const map = new Map<string, ParsedFileChange>();
						for (const file of parsed) {
							// Store with relative path as key for consistent lookups
							map.set(file.path, file);
						}
						setChangedFiles(map);
					})
					.catch(() => setChangedFiles(new Map()));
			}
		}, [repoPath, workspace?.workspace_path, basePath]);

		// Keyboard shortcut for search
		useKeyboardShortcut(
			"f",
			true,
			() => {
				if (selectedFile && !isBinaryFile(selectedFile)) {
					setIsSearchOpen(true);
					setSearchFocusTrigger((n) => n + 1);
				}
			},
			[selectedFile],
		);

		// Compute search matches
		const searchMatches = useMemo(() => {
			if (!debouncedSearchQuery || !fileContent) {
				return [];
			}
			return findMatches(fileContent, debouncedSearchQuery);
		}, [fileContent, debouncedSearchQuery]);

		// Search navigation handlers
		const handleSearchNext = useCallback(() => {
			if (searchMatches.length === 0) return;
			const newIndex = (currentMatchIndex + 1) % searchMatches.length;
			setCurrentMatchIndex(newIndex);

			// Scroll to the match
			const match = searchMatches[newIndex];
			if (match && listRef.current) {
				listRef.current.scrollToRow({
					index: match.lineNumber,
					align: "center",
				});
			}
		}, [searchMatches, currentMatchIndex]);

		const handleSearchPrevious = useCallback(() => {
			if (searchMatches.length === 0) return;
			const newIndex =
				(currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
			setCurrentMatchIndex(newIndex);

			// Scroll to the match
			const match = searchMatches[newIndex];
			if (match && listRef.current) {
				listRef.current.scrollToRow({
					index: match.lineNumber,
					align: "center",
				});
			}
		}, [searchMatches, currentMatchIndex]);

		const handleSearchClose = useCallback(() => {
			setIsSearchOpen(false);
			setSearchQuery("");
			setCurrentMatchIndex(0);
		}, []);

		// Helper function to calculate relative path
		const getRelativePath = useCallback(
			(fullPath: string): string => {
				if (basePath && fullPath.startsWith(`${basePath}/`)) {
					return fullPath.slice(basePath.length + 1);
				}
				return fullPath;
			},
			[basePath],
		);

		// Reset search when file changes
		useEffect(() => {
			setSearchQuery("");
			setCurrentMatchIndex(0);
			setIsSearchOpen(false);
		}, [selectedFile]);

		// Reset current match index when query changes
		useEffect(() => {
			setCurrentMatchIndex(0);
		}, [debouncedSearchQuery]);

		const handleFileClick = useCallback(
			async (path: string) => {
				setSelectedFile(path);
				getFileModifiedAt(path)
					.then((modifiedAt) => setSelectedFileModifiedAt(modifiedAt))
					.catch(() => setSelectedFileModifiedAt(null));

				// Check if binary file
				if (isBinaryFile(path)) {
					setFileContent("");
					setFileHunks(new Map());
					return;
				}

				setIsLoadingFile(true);
				try {
					const content = await readFile(path);

					// Don't load large files
					if (content.length > 1024 * 1024) {
						addToast({
							title: "File too large",
							description: "Files larger than 1MB cannot be displayed.",
							type: "warning",
						});
						setSelectedFile(null);
						setIsLoadingFile(false);
						return;
					}

					setFileContent(content);

					// Load hunks for line-level indicators
					const relPath = path.startsWith(`${basePath}/`)
						? path.slice(basePath.length + 1)
						: path;
					if (changedFilesRef.current.has(relPath) && repoPath) {
						try {
							const hunks = await getWorkspaceFileHunks(
								repoPath,
								workspace?.id ?? null,
								relPath,
							);
							const lineMap = new Map<number, "add" | "modify" | "delete">();
							const deletionSet = new Set<number>();

							hunks.forEach((hunk) => {
								// Parse the hunk header to get starting line number
								// Format: @@ -old_start,old_count +new_start,new_count @@
								const headerMatch = hunk.header.match(
									/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/,
								);
								if (!headerMatch) return;

								let newLineNum = parseInt(headerMatch[1], 10);

								hunk.lines.forEach((line) => {
									if (line.startsWith("+") && !line.startsWith("+++")) {
										lineMap.set(newLineNum, "add");
										newLineNum++;
									} else if (line.startsWith("-") && !line.startsWith("---")) {
										// Deletions don't have a line in the current file
										// Mark the line before where deletion occurred (show marker between lines)
										if (newLineNum > 1) {
											deletionSet.add(newLineNum - 1);
										}
									} else if (line.startsWith(" ")) {
										// Context line - just increment
										newLineNum++;
									}
								});
							});

							setFileHunks(lineMap);
							setDeletionMarkers(deletionSet);
						} catch (error) {
							console.error("Failed to load jj hunks:", error);
							setFileHunks(new Map());
							setDeletionMarkers(new Set());
						}
					} else {
						setFileHunks(new Map());
						setDeletionMarkers(new Set());
					}
				} catch (error) {
					addToast({
						title: "Failed to read file",
						description: error instanceof Error ? error.message : String(error),
						type: "error",
					});
					setFileContent("");
					setFileHunks(new Map());
				} finally {
					setIsLoadingFile(false);
				}
			},
			[addToast, basePath, repoPath, workspace?.id],
		);
		const handleFileClickRef = useRef(handleFileClick);
		handleFileClickRef.current = handleFileClick;

		// Line selection handlers
		const handleLineMouseDown = useCallback(
			(e: React.MouseEvent, lineNum: number, lineContent: string) => {
				void lineContent;
				if (e.button !== 0) return;
				// Code text must retain the browser's native drag selection. Starting our
				// line-range selection here causes React to re-render rows during the drag,
				// which collapses a selection as soon as it crosses a line boundary.
				if (
					e.target instanceof Element &&
					e.target.closest('[data-testid="code-line-content"]')
				) {
					return;
				}
				// Let the browser handle native word/line text selection on double-click+.
				if (e.detail >= 2) return;
				setIsSelecting(true);
				setSelectionAnchor(lineNum);
				setLineSelection({ startLine: lineNum, endLine: lineNum });
				setShowCommentInput(false);
			},
			[],
		);

		const handleLineMouseEnter = useCallback(
			(lineNum: number) => {
				if (!isSelecting || selectionAnchor === null) return;
				const start = Math.min(selectionAnchor, lineNum);
				const end = Math.max(selectionAnchor, lineNum);
				setLineSelection({ startLine: start, endLine: end });
			},
			[isSelecting, selectionAnchor],
		);

		const handleLineMouseUp = useCallback(() => {
			setIsSelecting(false);
		}, []);

		const handleSetHoveredLine = useCallback((lineNum: number | null) => {
			// Avoid re-rendering line rows while native text selection is active.
			if ((window.getSelection()?.toString() ?? "").length > 0) {
				return;
			}
			setHoveredLine(lineNum);
		}, []);

		const isLineSelected = useCallback(
			(lineNum: number) => {
				if (!lineSelection) return false;
				return (
					lineNum >= lineSelection.startLine && lineNum <= lineSelection.endLine
				);
			},
			[lineSelection],
		);

		// Comment handlers
		const handleAddComment = useCallback(
			(lineNum?: number) => {
				if (!selectedFile) return;

				const lines = fileContent.split("\n");
				let end: number, selectedLines: string[], start: number;

				if (
					lineNum !== undefined &&
					lineSelection &&
					lineNum >= lineSelection.startLine &&
					lineNum <= lineSelection.endLine &&
					lineSelection.startLine !== lineSelection.endLine
				) {
					// Multi-line selection exists and includes this line — use it
					start = lineSelection.startLine;
					end = lineSelection.endLine;
					selectedLines = lines.slice(start - 1, end);
				} else if (lineNum !== undefined) {
					// Single line comment from + button
					start = lineNum;
					end = lineNum;
					selectedLines = [lines[lineNum - 1]];
					setLineSelection({ startLine: lineNum, endLine: lineNum });
				} else if (lineSelection) {
					// Multi-line comment from selection
					start = lineSelection.startLine;
					end = lineSelection.endLine;
					selectedLines = lines.slice(start - 1, end);
				} else {
					return;
				}

				setPendingComment({
					startLine: start,
					endLine: end,
					lineContent: selectedLines,
				});
				setShowCommentInput(true);
			},
			[lineSelection, selectedFile, fileContent],
		);

		const handleSubmitComment = useCallback(
			(text: string) => {
				if (!pendingComment || !selectedFile) return;

				// Add to the FileBrowser's review session (batched, sent later via
				// "Finish review") instead of firing off a new agent session immediately.
				fileBrowserReview.addComment(
					{
						filePath: getRelativePath(selectedFile),
						hunkId: FILE_BROWSER_COMMENT_HUNK_ID,
						displayAtLineIndex: pendingComment.endLine - 1,
						startLine: pendingComment.startLine,
						endLine: pendingComment.endLine,
						lineContent: pendingComment.lineContent,
						lineSide: "new",
					},
					text,
				);

				setShowCommentInput(false);
				setPendingComment(null);
				setLineSelection(null);
			},
			[pendingComment, selectedFile, fileBrowserReview, getRelativePath],
		);

		const handleCancelComment = useCallback(() => {
			setShowCommentInput(false);
			setPendingComment(null);
		}, []);

		// Auto-select README.md when rootEntries change (switching workspaces)
		useEffect(() => {
			if (rootEntries.length === 0) return;
			if (initialSelectedFile) return;

			// Look for README.md (case-insensitive)
			const readme = rootEntries.find(
				(entry) =>
					!entry.is_directory && entry.name.toLowerCase() === "readme.md",
			);

			if (readme) {
				// Auto-select and load README.md
				handleFileClickRef.current(readme.path);
			} else {
				// Clear selection if no README.md
				setSelectedFile(null);
				setSelectedFileModifiedAt(null);
				setFileContent("");
			}
		}, [rootEntries, initialSelectedFile]);

		const loadDirectory = useCallback(
			async (path: string): Promise<DirectoryEntry[]> => {
				if (directoryCache.has(path)) {
					return directoryCache.get(path)!;
				}

				try {
					// Use cached version if workspace info is available
					let entries: DirectoryEntry[];
					if (workspace?.repo_path && workspace?.id !== undefined) {
						const cachedEntries = await listDirectoryCached(
							workspace.repo_path,
							workspace.id,
							path,
						);
						entries = cachedEntries;
					} else if (repoPath) {
						const cachedEntries = await listDirectoryCached(
							repoPath,
							null,
							path,
						);
						entries = cachedEntries;
					} else {
						entries = await listDirectory(path);
					}

					const filtered = filterHiddenEntries(entries);
					setDirectoryCache((prev) => new Map(prev).set(path, filtered));
					return filtered;
				} catch (error) {
					addToast({
						title: "Failed to load directory",
						description: error instanceof Error ? error.message : String(error),
						type: "error",
					});
					return [];
				}
			},
			[directoryCache, workspace, repoPath, addToast],
		);

		// Handle initial file selection from external navigation
		useEffect(() => {
			if (initialSelectedFile) {
				handleFileClickRef.current(initialSelectedFile);
			}
		}, [initialSelectedFile]);

		// Handle initial directory expansion from external navigation
		useEffect(() => {
			if (initialExpandedDir) {
				loadDirectory(initialExpandedDir)
					.then(() => {
						setExpandedDirs((prev) => new Set([...prev, initialExpandedDir]));
					})
					.catch(() => {
						// Silently fail if directory can't be loaded
					});
			}
		}, [initialExpandedDir, loadDirectory]);

		const hasChangedFilesInDirectory = useCallback(
			(dirPath: string): boolean => {
				const relDir = dirPath.startsWith(`${basePath}/`)
					? dirPath.slice(basePath.length + 1)
					: dirPath;
				for (const [path] of changedFiles) {
					if (path.startsWith(`${relDir}/`)) {
						return true;
					}
				}
				return false;
			},
			[changedFiles, basePath],
		);

		const getDirectoryChangeStatus = useCallback(
			(dirPath: string): ParsedFileChange | undefined => {
				// Check if any files in this directory are changed
				// Returns the first found change, or undefined if none
				const relDir = dirPath.startsWith(`${basePath}/`)
					? dirPath.slice(basePath.length + 1)
					: dirPath;
				for (const [path, file] of changedFiles) {
					if (path.startsWith(`${relDir}/`)) {
						return file;
					}
				}
				return undefined;
			},
			[changedFiles, basePath],
		);

		const handleDirectoryClick = async (path: string) => {
			if (expandedDirs.has(path)) {
				// Collapse
				setExpandedDirs((prev) => {
					const next = new Set(prev);
					next.delete(path);
					return next;
				});
			} else {
				// Expand and load
				await loadDirectory(path);
				setExpandedDirs((prev) => new Set(prev).add(path));
			}
		};

		const renderTreeNode = useCallback(
			(entry: DirectoryEntry, depth: number = 0): JSX.Element => {
				const isExpanded = expandedDirs.has(entry.path);
				const children = directoryCache.get(entry.path) || [];
				const hasChanges = hasChangedFilesInDirectory(entry.path);

				return (
					<TreeNode
						key={entry.path}
						entry={entry}
						depth={depth}
						isExpanded={isExpanded}
						childEntries={children}
						hasChanges={hasChanges}
						selectedFile={selectedFile}
						changedFiles={changedFiles}
						commentCounts={commentCountsByFile}
						basePath={basePath}
						onDirectoryClick={handleDirectoryClick}
						onFileClick={handleFileClick}
						getDirectoryChangeStatus={getDirectoryChangeStatus}
						renderChildren={renderTreeNode}
						getRelativePath={getRelativePath}
						addToast={addToast}
					/>
				);
			},
			[
				expandedDirs,
				directoryCache,
				hasChangedFilesInDirectory,
				selectedFile,
				changedFiles,
				commentCountsByFile,
				basePath,
				handleDirectoryClick,
				handleFileClick,
				getDirectoryChangeStatus,
				getRelativePath,
				addToast,
			],
		);

		// Calculate item height for virtualization
		const getItemHeight = useCallback(
			(index: number) => {
				if (
					showCommentInput &&
					pendingComment &&
					index === pendingComment.endLine
				) {
					return COMMENT_ROW_HEIGHT;
				}
				return LINE_HEIGHT;
			},
			[showCommentInput, pendingComment],
		);

		// Memoize file content data for virtualization
		const fileContentData = useMemo(() => {
			if (!selectedFile || !fileContent) return null;

			const language = getLanguageFromPath(selectedFile);
			const highlightedCode = language
				? highlightCode(fileContent, language)
				: fileContent
						.replace(/&/g, "&amp;")
						.replace(/</g, "&lt;")
						.replace(/>/g, "&gt;");

			const lines = highlightedCode.split("\n");
			const rawLines = fileContent.split("\n");
			const lineNumberWidth = Math.max(4, String(lines.length).length);

			return { lines, rawLines, lineNumberWidth, language };
		}, [selectedFile, fileContent]);

		// Memoize sorted root entries to avoid re-sorting on every render
		const sortedRootEntries = useMemo(
			() =>
				[...rootEntries].sort((a, b) => {
					// Directories first, then alphabetically
					if (a.is_directory === b.is_directory) {
						return a.name.localeCompare(b.name);
					}
					return a.is_directory ? -1 : 1;
				}),
			[rootEntries],
		);

		const renderFileContent = () => (
			<FileContentView
				selectedFile={selectedFile}
				selectedFileModifiedAt={selectedFileModifiedAt}
				isLoadingFile={isLoadingFile}
				fileContent={fileContent}
				fileContentData={fileContentData}
				basePath={basePath}
				fileHunks={fileHunks}
				deletionMarkers={deletionMarkers}
				getItemHeight={getItemHeight}
				onSetHoveredLine={handleSetHoveredLine}
				fontSize={fontSize}
				hoveredLine={hoveredLine}
				isSelecting={isSelecting}
				onLineMouseDown={handleLineMouseDown}
				onLineMouseEnter={handleLineMouseEnter}
				onLineMouseUp={handleLineMouseUp}
				isLineSelected={isLineSelected}
				onAddComment={handleAddComment}
				showCommentInput={showCommentInput}
				pendingComment={pendingComment}
				onSubmitComment={handleSubmitComment}
				onCancelComment={handleCancelComment}
				listRef={listRef}
				isSearchOpen={isSearchOpen}
				searchQuery={debouncedSearchQuery}
				searchQueryDisplay={searchQuery}
				searchMatches={searchMatches}
				currentMatchIndex={currentMatchIndex}
				onSearchQueryChange={setSearchQuery}
				onSearchNext={handleSearchNext}
				onSearchPrevious={handleSearchPrevious}
				onSearchClose={handleSearchClose}
				searchFocusTrigger={searchFocusTrigger}
			/>
		);

		const pendingCommentCount = fileBrowserReview.comments.length;

		return (
			<div
				className="h-full flex flex-col bg-background overflow-hidden"
				data-testid="file-browser"
			>
				{/* Header: Back + review controls, sharing one row */}
				<div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2 border-b border-border flex-shrink-0">
					<div>
						{onBack && (
							<button
								type="button"
								onClick={onBack}
								className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
							>
								<ChevronLeft className="w-4 h-4" />
								Back
							</button>
						)}
					</div>
					{pendingCommentCount > 0 && (
						<div className="flex items-center gap-2">
							<span className="flex items-center gap-1.5 text-sm text-muted-foreground">
								<MessageSquare className="w-4 h-4 text-primary" />
								{pendingCommentCount} comment
								{pendingCommentCount !== 1 ? "s" : ""} pending
							</span>
							<Button
								size="sm"
								variant="outline"
								onClick={() => fileBrowserReview.setShowCancelDialog(true)}
							>
								Discard
							</Button>
							<Popover
								open={fileBrowserReview.reviewPopoverOpen}
								onOpenChange={fileBrowserReview.setReviewPopoverOpen}
							>
								<PopoverTrigger asChild>
									<Button size="sm" variant="default" className="gap-2">
										<Send className="w-3 h-3" />
										Finish review
									</Button>
								</PopoverTrigger>
								<PopoverContent
									align="end"
									side="bottom"
									className="w-80 relative"
								>
									<button
										type="button"
										onClick={() =>
											fileBrowserReview.setReviewPopoverOpen(false)
										}
										className="h-8 w-8 absolute top-2 right-2 flex items-center justify-center rounded hover:bg-muted"
										aria-label="Close"
										title="Close"
										disabled={fileBrowserReview.sendingReview}
									>
										<X className="w-4 h-4" />
									</button>
									<div className="space-y-3">
										<div>
											<h4 className="font-medium text-sm mb-1">
												Finish your review
											</h4>
											<p className="text-sm text-muted-foreground">
												{pendingCommentCount} comment
												{pendingCommentCount !== 1 ? "s" : ""} will be
												submitted.
											</p>
										</div>
										<Textarea
											value={fileBrowserReview.finalReviewComment}
											onChange={(event) =>
												fileBrowserReview.setFinalReviewComment(
													event.target.value,
												)
											}
											placeholder="Add a summary comment (optional)..."
											className="min-h-[80px] text-sm"
										/>
										<div className="flex justify-between gap-2">
											<Button
												size="sm"
												variant="outline"
												onClick={fileBrowserReview.handleCopyReview}
												className="gap-2"
												disabled={fileBrowserReview.sendingReview}
											>
												{fileBrowserReview.copiedReview ? (
													<>
														<Check className="w-3 h-3" />
														Copied
													</>
												) : (
													<>
														<Copy className="w-3 h-3" />
														Copy
													</>
												)}
											</Button>
											<div className="flex gap-2">
												<Button
													size="sm"
													variant="secondary"
													onClick={() =>
														fileBrowserReview.handleRequestChanges("plan")
													}
													disabled={fileBrowserReview.sendingReview}
												>
													Plan
												</Button>
												<Button
													size="sm"
													onClick={() =>
														fileBrowserReview.handleRequestChanges(
															"acceptEdits",
														)
													}
													disabled={fileBrowserReview.sendingReview}
												>
													Edit
												</Button>
											</div>
										</div>
									</div>
								</PopoverContent>
							</Popover>
						</div>
					)}
				</div>

				<AlertDialog
					open={fileBrowserReview.showCancelDialog}
					onOpenChange={fileBrowserReview.setShowCancelDialog}
				>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Discard review?</AlertDialogTitle>
							<AlertDialogDescription>
								This will discard all {pendingCommentCount} pending comment
								{pendingCommentCount !== 1 ? "s" : ""}. This action cannot be
								undone.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Keep reviewing</AlertDialogCancel>
							<AlertDialogAction onClick={fileBrowserReview.handleCancelReview}>
								Discard
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>

				<div className="flex-1 flex min-h-0 overflow-hidden">
					{/* File Tree */}
					<div className="w-72 flex-shrink-0 border-r bg-sidebar overflow-auto">
						{isLoadingDir && rootEntries.length === 0 ? (
							<div className="flex items-center justify-center p-4">
								<Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
							</div>
						) : (
							<div className="p-3 space-y-1">
								{sortedRootEntries.map((entry) => renderTreeNode(entry, 0))}
							</div>
						)}
					</div>

					{/* File Content */}
					<div className="flex-1 min-w-0 bg-background overflow-auto">
						{renderFileContent()}
					</div>
				</div>
			</div>
		);
	},
);
