/* eslint-disable max-lines, max-params */

import {
	type QueryClient,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import {
	AlertTriangle,
	ArrowRight,
	ChevronLeft,
	Code2,
	Eye,
	EyeOff,
	File,
	FileDiff,
	Folder,
	GitBranch,
	GitCommitHorizontal,
	GitCompareArrows,
	GitMerge,
	Layers2,
	Loader2,
	MoreVertical,
	RefreshCw,
	Search,
	Trash2,
	Upload,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	useEnqueueWorkspace,
	useMergeQueueEnabled,
	useMergeQueueStatus,
} from "../hooks/useMergeQueueStatus";
import { useTerminalSettings } from "../hooks/useTerminalSettings";
import {
	checkAndRebaseWorkspaces,
	createSession,
	type DirectoryEntry,
	discardWorkspaceChanges,
	dryRunHomeRepoRebase,
	getRepoSetting,
	getSetting,
	getWorkspaceReadme,
	getWorkspaceStatus,
	type HomeRebaseDryRunResult,
	type JjLogResult,
	listCommits,
	lsWorkspace,
	pullWorkspaceFromRemote,
	pushWorkspaceToRemote,
	rebaseHomeRepoBranch,
	resolveBookmarkConflict,
	type SingleRebaseResult,
	updateWorkspace,
	type Workspace,
	type WorkspaceBookmarkConflict,
} from "../lib/api";
import { FEATURES } from "../lib/features";
import { getStatusBgColor } from "../lib/git-status-colors";
import type { ParsedFileChange } from "../lib/git-utils";
import { cn, getFullWorkspacePath, resolveReadmeImageSrc } from "../lib/utils";
import type { SessionCreationInfo } from "../types/sessions";
import {
	ChangesDiffViewer,
	type ChangesDiffViewerHandle,
} from "./ChangesDiffViewer";
import { CommitDiffViewer } from "./CommitDiffViewer";
import { CreatePrButtonGroup } from "./CreatePrButtonGroup";
import { FileBrowser } from "./FileBrowser";
import { LinearCommitHistory } from "./LinearCommitHistory";
import { MarkdownContent } from "./MarkdownContent";
import {
	type BranchListItem,
	TargetBranchSelector,
} from "./TargetBranchSelector";
import { TaskInput } from "./TaskInput";
import { Button } from "./ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Kbd, KbdGroup } from "./ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { useToast } from "./ui/toast";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "./ui/tooltip";
import { ViewPrButton } from "./ViewPrButton";
import { WorkspaceBookmarkConflictModal } from "./WorkspaceBookmarkConflictModal";
import { WorkspaceStackPanel } from "./WorkspaceStackPanel";

interface ShowWorkspaceProps {
	repositoryPath?: string;
	workspace: Workspace | null;
	mainRepoBranch?: string | null;
	initialSelectedFile: string | null;
	onDeleteWorkspace?: (workspace: Workspace) => void;
	onOpenFilePicker?: () => void;
	onSessionCreated?: (session: SessionCreationInfo) => void;
	taskInputFocusRequest?: number;
	onOpenMergePreview?: () => void;
	onOpenBranchSwitcher?: () => void;
	onCreateStackedWorkspace?: () => void;
	/** Called when the user clicks a sibling workspace in the stack panel */
	onNavigateToWorkspace?: (workspace: Workspace) => void;
	onViewPrInApp?: (prNumber: number) => void;
	/** Called when user wants to move a commit to a new workspace */
	onMoveCommitToNewWorkspace?: (
		commit: import("../lib/api").JjLogCommit,
		workspace: Workspace | null,
	) => void;
	/** Called when user wants to move a commit to an existing workspace */
	onMoveCommitToExistingWorkspace?: (
		commit: import("../lib/api").JjLogCommit,
		workspace: Workspace | null,
	) => void;
	/** Called when user wants to move files to a new workspace */
	onMoveFilesToNewWorkspace?: (
		files: string[],
		workspace: Workspace | null,
	) => void;
	onActiveTabChange?: (tab: string) => void;
	availableBranches?: BranchListItem[];
	branchesLoading?: boolean;
	onLoadAvailableBranches?: () => void | Promise<void>;
	queryClient?: QueryClient;
}

export const ShowWorkspace = memo<ShowWorkspaceProps>(
	({
		repositoryPath,
		workspace,
		mainRepoBranch,
		initialSelectedFile,
		onDeleteWorkspace,
		onOpenFilePicker,
		onSessionCreated,
		taskInputFocusRequest,
		onOpenMergePreview,
		onOpenBranchSwitcher,
		onCreateStackedWorkspace,
		onNavigateToWorkspace,
		onViewPrInApp,
		onMoveCommitToNewWorkspace,
		onMoveCommitToExistingWorkspace,
		onMoveFilesToNewWorkspace,
		onActiveTabChange,
		availableBranches = [],
		branchesLoading = false,
		onLoadAvailableBranches,
	}) => {
		const workingDirectory = workspace
			? getFullWorkspacePath(workspace)
			: repositoryPath || "";
		const effectiveRepoPath = workspace?.repo_path || repositoryPath || "";

		const { addToast } = useToast();
		const { fontSize } = useTerminalSettings();

		const { data: queueEnabled } = useMergeQueueEnabled(
			effectiveRepoPath || undefined,
		);
		const { data: queueStatus } = useMergeQueueStatus(
			effectiveRepoPath || undefined,
			workspace?.branch_name,
		);
		const { enqueue, dequeue } = useEnqueueWorkspace(
			effectiveRepoPath || undefined,
			workspace?.branch_name,
		);

		const [changedFiles, setChangedFiles] = useState<
			Map<string, ParsedFileChange>
		>(new Map());
		const [initialSelectedFileForBrowser, setInitialSelectedFileForBrowser] =
			useState<string | null>(null);
		const [initialExpandedDir, setInitialExpandedDir] = useState<string | null>(
			null,
		);

		const changesDiffViewerRef = useRef<ChangesDiffViewerHandle>(null);
		const [actionPending, _setActionPending] = useState<
			"push" | "merge" | "sync" | null
		>(null);

		// Sync status state (ahead/behind counts)
		const [syncStatus, setSyncStatus] = useState<{
			ahead: number;
			behind: number;
		} | null>(null);

		// Aggregate diff stats (insertions/deletions across all commits)
		const [diffStats] = useState<{
			insertions: number;
			deletions: number;
		} | null>(null);

		// Target branch and conflicts state
		const [targetBranch, setTargetBranch] = useState<string | null>(null);
		const defaultBranch = "main";
		const defaultTargetBranch = mainRepoBranch || defaultBranch;
		const [conflictedFiles, setConflictedFiles] = useState<string[]>([]);
		const normalizedConflictedFiles = useMemo(() => {
			const seen = new Set<string>();
			const normalized: string[] = [];
			for (const path of conflictedFiles) {
				const trimmed = path.trim();
				if (!trimmed || seen.has(trimmed)) continue;
				seen.add(trimmed);
				normalized.push(trimmed);
			}
			return normalized;
		}, [conflictedFiles]);
		const conflictCount = normalizedConflictedFiles.length;

		// Committed changes toggle state
		const [showCommittedChanges, setShowCommittedChanges] = useState(true);
		// Whether the workspace has any of its own commits (not target-only, not working-copy)
		const [hasWorkspaceCommits, setHasWorkspaceCommits] = useState(false);

		// Home-repo branch divergence: counts of target-ahead commits and conflict dry-run result
		const [homeRepoTargetAheadCount, setHomeRepoTargetAheadCount] = useState(0);
		const [homeRebaseDryRun, setHomeRebaseDryRun] =
			useState<HomeRebaseDryRunResult | null>(null);
		const [homeRebasing, setHomeRebasing] = useState(false);

		const [rebasing, setRebasing] = useState(false);
		const [bookmarkConflict, setBookmarkConflict] =
			useState<WorkspaceBookmarkConflict | null>(null);
		const [conflictModalOpen, setConflictModalOpen] = useState(false);
		const [resolvingBookmarkConflict, setResolvingBookmarkConflict] =
			useState(false);
		const [refreshingFiles, setRefreshingFiles] = useState(false);

		// Show overview tab by default for main repo, changes tab for workspaces
		const [activeTab, setActiveTab] = useState("overview");
		const [scrollToCommitId, setScrollToCommitId] = useState<string | null>(
			null,
		);
		const [showFileBrowserInCode, setShowFileBrowserInCode] = useState(false);

		const handleChangedFilesUpdate = useCallback(
			(parsedFiles: ParsedFileChange[]) => {
				const map = new Map<string, ParsedFileChange>();
				for (const file of parsedFiles) {
					const fullPath = `${workingDirectory}/${file.path}`;
					map.set(fullPath, file);
				}
				setChangedFiles(map);
			},
			[workingDirectory],
		);

		useEffect(() => {
			setActiveTab("overview");
			setBookmarkConflict(null);
			setConflictModalOpen(false);
		}, [workspace?.id]);

		useEffect(() => {
			if (taskInputFocusRequest) setActiveTab("overview");
		}, [taskInputFocusRequest]);

		// Load workspace commit count to control Committed toggle availability
		const loadWorkspaceCommitCount = useCallback(async () => {
			if (!effectiveRepoPath || workspace?.id === undefined) {
				setHasWorkspaceCommits(false);
				return;
			}
			try {
				const result = await listCommits(effectiveRepoPath, workspace.id);
				setHasWorkspaceCommits(
					(result.commits ?? []).some(
						(c) => !c.on_target_only && !c.is_working_copy,
					),
				);
			} catch {
				setHasWorkspaceCommits(false);
			}
		}, [effectiveRepoPath, workspace?.id]);

		useEffect(() => {
			loadWorkspaceCommitCount();
		}, [loadWorkspaceCommitCount]);

		// After a child refresh (e.g. post-commit), re-check if workspace now has commits
		const handleRefreshingChange = useCallback(
			(r: boolean) => {
				setRefreshingFiles(r);
				if (!r) loadWorkspaceCommitCount();
			},
			[loadWorkspaceCommitCount],
		);

		// When commits are loaded from LinearCommitHistory, capture divergence counts
		const handleCommitsLoaded = useCallback((result: JjLogResult) => {
			const targetAheadCount =
				result.commits?.filter((commit) => commit.on_target_only).length ?? 0;
			setHomeRepoTargetAheadCount(targetAheadCount);
			// Reset dry-run when commit data changes
			setHomeRebaseDryRun(null);
		}, []);

		useEffect(() => {
			if (!workspace) {
				setTargetBranch(null);
				return;
			}
			setTargetBranch(workspace.target_branch ?? defaultTargetBranch);
		}, [workspace?.id, workspace?.target_branch, defaultTargetBranch]);

		// Run conflict dry-run when on a home-repo non-default branch with target-ahead commits
		useEffect(() => {
			const isHomeRepo = !workspace;
			if (!isHomeRepo) return;
			if (!effectiveRepoPath) return;
			if (homeRepoTargetAheadCount === 0) {
				setHomeRebaseDryRun(null);
				return;
			}
			const currentBranch = mainRepoBranch;
			if (!currentBranch) return;
			const targetBranchName = defaultBranch;
			dryRunHomeRepoRebase(effectiveRepoPath, currentBranch, targetBranchName)
				.then(setHomeRebaseDryRun)
				.catch(() => setHomeRebaseDryRun(null));
		}, [
			workspace,
			effectiveRepoPath,
			homeRepoTargetAheadCount,
			mainRepoBranch,
			defaultBranch,
		]);

		useEffect(() => {
			onActiveTabChange?.(activeTab);
		}, [activeTab, onActiveTabChange]);

		const { data: workspaceStatusData, refetch: refetchWorkspaceStatus } =
			useQuery({
				queryKey: [
					"workspace-status",
					effectiveRepoPath,
					workspace?.id ?? null,
				],
				enabled: Boolean(effectiveRepoPath),
				placeholderData: (previousData) => previousData,
				queryFn: () =>
					getWorkspaceStatus(effectiveRepoPath, workspace?.id ?? null),
			});

		const { data: overviewData, isPending: overviewPending } = useQuery({
			queryKey: [
				"workspace-overview",
				effectiveRepoPath,
				workspace?.id ?? null,
			],
			enabled: Boolean(effectiveRepoPath) && activeTab === "overview",
			placeholderData: (previousData) => previousData,
			queryFn: async () => {
				try {
					const [entries, readme] = await Promise.all([
						lsWorkspace(effectiveRepoPath, workspace?.id ?? null),
						getWorkspaceReadme(effectiveRepoPath, workspace?.id ?? null),
					]);
					return { entries, readme };
				} catch (error) {
					console.error("Failed to load workspace overview:", error);
					return { entries: [], readme: null as string | null };
				}
			},
		});

		const rootEntries = overviewData?.entries ?? [];
		const readmeContent = overviewData?.readme ?? null;
		const readmeBaseDir = workspace
			? getFullWorkspacePath(workspace)
			: effectiveRepoPath;

		const handleBookmarkConflictsFromResult = useCallback(
			(result?: SingleRebaseResult | null) => {
				if (!workspace) {
					setBookmarkConflict(null);
					setConflictModalOpen(false);
					return false;
				}

				const conflicts = result?.bookmark_conflicts ?? [];
				const conflictForWorkspace = conflicts.find(
					(conflict) => conflict.workspace_id === workspace.id,
				);

				if (conflictForWorkspace) {
					setBookmarkConflict(conflictForWorkspace);
					setConflictModalOpen(true);
					return true;
				}

				if (bookmarkConflict) {
					setBookmarkConflict(null);
					setConflictModalOpen(false);
				}

				return false;
			},
			[workspace, bookmarkConflict],
		);

		// Files list expansion state
		// 		setTargetBranch(value);
		// 	}
		// }, [workspace?.target_branch, defaultBranch]);

		// Invalidate sidebar query when conflicts change
		const queryClient = useQueryClient();

		useEffect(() => {
			if (!workspaceStatusData) return;
			setConflictedFiles(workspaceStatusData.conflicted_files ?? []);
			const sync = workspaceStatusData.remote_sync;
			if (sync.type === "Ahead") {
				setSyncStatus({ ahead: sync.data.count, behind: 0 });
			} else if (sync.type === "Behind") {
				setSyncStatus({ ahead: 0, behind: sync.data.count });
			} else if (sync.type === "Diverged") {
				setSyncStatus({ ahead: sync.data.ahead, behind: sync.data.behind });
			} else {
				setSyncStatus({ ahead: 0, behind: 0 });
			}
		}, [workspaceStatusData]);

		// Handle file selection from Cmd+P (or other external sources)
		useEffect(() => {
			if (initialSelectedFile) {
				setInitialSelectedFileForBrowser(initialSelectedFile);
				// Extract parent directory from file path
				const parentDir = initialSelectedFile.substring(
					0,
					initialSelectedFile.lastIndexOf("/"),
				);
				setInitialExpandedDir(parentDir);
				setShowFileBrowserInCode(true);
			}
		}, [initialSelectedFile]);

		const handleTargetBranchSelect = useCallback(
			async (branch: string) => {
				if (branch === targetBranch || !workspace) return;

				setRebasing(true);
				try {
					await updateWorkspace(effectiveRepoPath, workspace.id, branch);

					addToast({
						title: "Rebased successfully",
						description: `Workspace rebased onto ${branch}`,
						type: "success",
					});

					// Invalidate sidebar queries so hierarchy updates
					queryClient.invalidateQueries({
						queryKey: ["workspaces", effectiveRepoPath],
					});
					queryClient.invalidateQueries({
						queryKey: ["workspace-statuses", effectiveRepoPath],
					});
					queryClient.invalidateQueries({
						queryKey: ["workspace-status", effectiveRepoPath, workspace.id],
					});

					setTargetBranch(branch);
				} catch (error) {
					addToast({
						title: "Rebase failed",
						description: error instanceof Error ? error.message : String(error),
						type: "error",
					});
				} finally {
					setRebasing(false);
				}
			},
			[targetBranch, workspace, effectiveRepoPath, addToast, queryClient],
		);

		// Helper to get status for a directory entry
		const getEntryStatus = useCallback(
			(entry: DirectoryEntry): string | undefined => {
				const fullPath = `${workingDirectory}/${entry.name}`;
				if (!entry.is_directory) {
					const file = changedFiles.get(fullPath);
					if (!file) return undefined;
					// Prefer workspaceStatus (unstaged) over stagedStatus
					return file.workspaceStatus || file.stagedStatus || undefined;
				}
				// For directories, check if any child has changes
				for (const [path] of changedFiles) {
					if (path.startsWith(`${fullPath}/`)) {
						return "M"; // Show modified indicator if any child changed
					}
				}
				return undefined;
			},
			[workingDirectory, changedFiles],
		);

		// Handler for clicking on Overview entries
		const handleOverviewEntryClick = useCallback(
			(entry: DirectoryEntry) => {
				const fullPath = `${workingDirectory}/${entry.name}`;
				if (entry.is_directory) {
					setInitialExpandedDir(fullPath);
					setInitialSelectedFileForBrowser(null); // Will select README in browser
				} else {
					setInitialSelectedFileForBrowser(fullPath);
					setInitialExpandedDir(null);
				}
				setShowFileBrowserInCode(true);
			},
			[workingDirectory],
		);

		const handlePushToRemote = useCallback(async () => {
			if (!effectiveRepoPath) return false;

			_setActionPending("push");

			try {
				await pushWorkspaceToRemote(effectiveRepoPath, workspace?.id ?? null);

				addToast({
					title: "Pushed to remote",
					description: "Changes pushed successfully",
					type: "success",
				});
				// Refresh sync status after push
				await refetchWorkspaceStatus();
				queryClient?.invalidateQueries();
				return true;
			} catch (error) {
				console.error("Push failed:", error);
				addToast({
					title: "Push failed",
					description: String(error),
					type: "error",
				});
				return false;
			} finally {
				_setActionPending(null);
			}
		}, [
			workspace,
			effectiveRepoPath,
			addToast,
			refetchWorkspaceStatus,
			queryClient,
		]);

		const handleSync = useCallback(async () => {
			if (!effectiveRepoPath) return;

			_setActionPending("sync");
			try {
				await pullWorkspaceFromRemote(effectiveRepoPath, workspace?.id ?? null);
				await pushWorkspaceToRemote(effectiveRepoPath, workspace?.id ?? null);

				addToast({
					title: "Synced with remote",
					description: "Fetched and pushed changes",
					type: "success",
				});

				await refetchWorkspaceStatus();
				queryClient?.invalidateQueries();
			} catch (error) {
				console.error("Sync failed:", error);
				addToast({
					title: "Sync failed",
					description: String(error),
					type: "error",
				});
			} finally {
				_setActionPending(null);
			}
		}, [
			workspace,
			effectiveRepoPath,
			addToast,
			refetchWorkspaceStatus,
			queryClient,
		]);

		const handleViewTentativeChanges = useCallback(() => {
			setActiveTab("changes");
		}, []);

		const handleDeleteTentativeChanges = useCallback(async () => {
			if (!workspace?.workspace_path || !effectiveRepoPath) return;

			try {
				await discardWorkspaceChanges(workingDirectory);
				addToast({
					title: "Changes discarded",
					description: "Working copy changes were removed",
					type: "success",
				});
				await Promise.all([
					refetchWorkspaceStatus(),
					queryClient.invalidateQueries({
						queryKey: [
							"commit-diff-viewer-commits",
							effectiveRepoPath,
							workspace.id,
						],
					}),
					queryClient.invalidateQueries({
						queryKey: ["workspace-status", effectiveRepoPath, workspace.id],
					}),
					queryClient.invalidateQueries({
						queryKey: ["workspace-overview", effectiveRepoPath, workspace.id],
					}),
				]);
			} catch (error) {
				addToast({
					title: "Failed to discard changes",
					description: error instanceof Error ? error.message : String(error),
					type: "error",
				});
			}
		}, [
			workspace,
			effectiveRepoPath,
			addToast,
			queryClient,
			refetchWorkspaceStatus,
		]);

		const handleHomeRebase = useCallback(async () => {
			if (!effectiveRepoPath || !mainRepoBranch) return;
			setHomeRebasing(true);
			try {
				const result = await rebaseHomeRepoBranch(
					effectiveRepoPath,
					mainRepoBranch,
					defaultBranch,
				);
				if (result.success) {
					addToast({
						title: "Rebase complete",
						description: result.message || "Branch rebased onto target",
						type: "success",
					});
					queryClient?.invalidateQueries();
					// Reset divergence state — LinearCommitHistory will refetch
					setHomeRepoTargetAheadCount(0);
					setHomeRebaseDryRun(null);
				} else {
					addToast({
						title: "Rebase failed",
						description: result.message,
						type: "error",
					});
				}
			} catch (error) {
				addToast({
					title: "Rebase failed",
					description: String(error),
					type: "error",
				});
			} finally {
				setHomeRebasing(false);
			}
		}, [
			effectiveRepoPath,
			mainRepoBranch,
			defaultBranch,
			addToast,
			queryClient,
		]);

		const handleForceRebaseWorkspace = useCallback(async () => {
			if (!workspace || !effectiveRepoPath) return;

			setRebasing(true);
			try {
				const result = await checkAndRebaseWorkspaces(
					effectiveRepoPath,
					workspace.id,
					targetBranch ?? defaultTargetBranch,
					true,
				);

				handleBookmarkConflictsFromResult(result);

				if (result.success) {
					addToast({
						title: "Force rebase complete",
						description:
							"Rebased workspace subtree from current workspace scope.",
						type: "success",
					});
				} else {
					addToast({
						title: "Force rebase completed with errors",
						description: result.message || "Some workspaces failed to rebase.",
						type: "warning",
					});
				}

				queryClient.invalidateQueries({
					queryKey: ["workspaces", effectiveRepoPath],
				});
				queryClient.invalidateQueries({
					queryKey: ["workspace-statuses", effectiveRepoPath],
				});
			} catch (error) {
				addToast({
					title: "Force rebase failed",
					description: error instanceof Error ? error.message : String(error),
					type: "error",
				});
			} finally {
				setRebasing(false);
			}
		}, [
			workspace,
			effectiveRepoPath,
			targetBranch,
			defaultTargetBranch,
			handleBookmarkConflictsFromResult,
			addToast,
			queryClient,
		]);

		const handleResolveBookmarkConflict = useCallback(
			async (revisionId: string) => {
				if (
					!workspace ||
					!effectiveRepoPath ||
					!bookmarkConflict ||
					!targetBranch
				) {
					return;
				}

				setResolvingBookmarkConflict(true);
				try {
					await resolveBookmarkConflict(
						effectiveRepoPath,
						workspace.id,
						workingDirectory,
						bookmarkConflict.branch_name,
						revisionId,
					);

					addToast({
						title: "Bookmark updated",
						description: `Set ${bookmarkConflict.branch_name} to ${revisionId}`,
						type: "success",
					});

					setBookmarkConflict(null);
					setConflictModalOpen(false);

					const result = await checkAndRebaseWorkspaces(
						effectiveRepoPath,
						workspace.id,
						targetBranch,
						true,
					);
					if (result) {
						handleBookmarkConflictsFromResult(result);
					}
				} catch (error) {
					addToast({
						title: "Failed to resolve conflict",
						description: error instanceof Error ? error.message : String(error),
						type: "error",
					});
				} finally {
					setResolvingBookmarkConflict(false);
				}
			},
			[
				workspace,
				effectiveRepoPath,
				bookmarkConflict,
				workingDirectory,
				addToast,
				targetBranch,
				handleBookmarkConflictsFromResult,
			],
		);

		const handleCreateAgentWithComment = useCallback(
			async (
				filePath: string,
				startLine: number,
				endLine: number,
				lineContent: string[],
				commentText: string,
				commitShortId?: string,
				mode?: "plan" | "acceptEdits",
			) => {
				try {
					// Format comment as markdown
					const relativePath = filePath.startsWith(`${workingDirectory}/`)
						? filePath.slice(workingDirectory.length + 1)
						: filePath;

					const lineRef = `${relativePath}:${startLine}${
						startLine !== endLine ? `-${endLine}` : ""
					}${commitShortId ? ` (commit ${commitShortId})` : ""}`;
					const formattedComment = `${lineRef}\n\`\`\`\n${lineContent.join(
						"\n",
					)}\n\`\`\`\n> ${commentText}\n`;
					const sessionName = "Code Comment";

					// Create new database session
					const dbSessionId = await createSession(
						effectiveRepoPath,
						workspace?.id ?? null,
						sessionName,
					);
					const sessionRepoPath = effectiveRepoPath || workingDirectory;

					// Notify parent with pending prompt to be sent after Claude initializes
					// (ConsolidatedTerminal will create the PTY session when it mounts)
					onSessionCreated?.({
						sessionId: dbSessionId,
						sessionName,
						workspaceId: workspace?.id ?? null,
						workspacePath: workspace?.workspace_path ?? null,
						repoPath: sessionRepoPath,
						pendingPrompt: formattedComment,
						permissionMode: mode,
					});

					addToast({
						title: "Comment sent to agent",
						description: `Created new agent session and sent comment`,
						type: "success",
					});
				} catch (error) {
					addToast({
						title: "Failed to create agent",
						description: error instanceof Error ? error.message : String(error),
						type: "error",
					});
				}
			},
			[
				workingDirectory,
				effectiveRepoPath,
				workspace,
				addToast,
				onSessionCreated,
			],
		);

		const handleCreateAgentWithReview = useCallback(
			async (reviewMarkdown: string, mode: "plan" | "acceptEdits") => {
				try {
					const sessionName = "Code Review";

					// Resolve the default agent from repo-level then app-level settings,
					// so "send review to terminal" honours the configured default agent.
					let resolvedAgent: "claude" | "codex" | "cursor" | undefined;
					const repoPathForSettings = effectiveRepoPath || workingDirectory;
					try {
						let repoDefault: string | null = null;
						let appDefault: string | null = null;
						try {
							repoDefault = await getRepoSetting(
								repoPathForSettings,
								"default_agent",
							);
						} catch {
							// repo may not be initialized yet
						}
						try {
							appDefault = await getSetting("default_agent");
						} catch {
							// ignore
						}
						const defaultAgent = repoDefault || appDefault;
						if (
							defaultAgent === "codex" ||
							defaultAgent === "cursor" ||
							defaultAgent === "claude"
						) {
							resolvedAgent = defaultAgent;
						}
					} catch {
						// fall back to undefined (Dashboard will default to claude)
					}

					// Create new database session
					const dbSessionId = await createSession(
						effectiveRepoPath,
						workspace?.id ?? null,
						sessionName,
					);
					const sessionRepoPath = effectiveRepoPath || workingDirectory;

					// Notify parent with pending prompt to be sent after agent initializes
					// (ConsolidatedTerminal will create the PTY session when it mounts)
					onSessionCreated?.({
						sessionId: dbSessionId,
						sessionName,
						workspaceId: workspace?.id ?? null,
						workspacePath: workspace?.workspace_path ?? null,
						repoPath: sessionRepoPath,
						pendingPrompt: reviewMarkdown,
						permissionMode: mode,
						agent: resolvedAgent,
					});
				} catch (error) {
					addToast({
						title: "Failed to create agent",
						description: error instanceof Error ? error.message : String(error),
						type: "error",
					});
					throw error;
				}
			},
			[
				workingDirectory,
				effectiveRepoPath,
				workspace,
				addToast,
				onSessionCreated,
			],
		);

		// Display all files in the list
		const displayedEntries = rootEntries;

		// Status pip component for file/directory indicators
		const StatusPip = ({ status }: { status?: string }) =>
			status ? (
				<span
					className={cn(
						"w-2 h-2 rounded-full flex-shrink-0",
						getStatusBgColor(status),
					)}
				/>
			) : null;

		const executionPanel = workingDirectory ? (
			<div className="flex flex-col h-full">
				<div className="flex-shrink-0 bg-background px-4 py-2 border-b border-border flex items-center justify-between">
					<Tabs value={activeTab} onValueChange={setActiveTab}>
						<TabsList>
							<TabsTrigger
								value="overview"
								className="inline-flex items-center"
							>
								<Code2 className="w-4 h-4 mr-1.5" />
								Code
							</TabsTrigger>
							<TabsTrigger
								value="commits"
								className="inline-flex items-center gap-1.5"
							>
								<GitCommitHorizontal className="w-4 h-4" />
								<span>Commits</span>
							</TabsTrigger>
							<TabsTrigger
								value="changes"
								className="inline-flex items-center gap-1.5"
							>
								<FileDiff className="w-4 h-4" />
								<span>Review</span>
								{changedFiles.size > 0 && (
									<span
										className={cn(
											"rounded-full px-2 py-0.5 text-xs font-medium transition-colors",
											conflictCount > 0
												? "bg-destructive text-destructive-foreground"
												: "bg-muted text-muted-foreground",
										)}
									>
										{changedFiles.size}
									</span>
								)}
							</TabsTrigger>
						</TabsList>
					</Tabs>
					<div className="flex items-center gap-3">
						{(rebasing || refreshingFiles) && (
							<div className="flex items-center gap-2 text-sm text-muted-foreground">
								<Loader2 className="w-4 h-4 animate-spin" />
								<span>{rebasing ? "Rebasing..." : "Refreshing..."}</span>
							</div>
						)}
						{diffStats && (
							<div className="flex items-center gap-1.5 text-xs font-mono">
								<span className="text-green-600 dark:text-green-400">
									+{diffStats.insertions}
								</span>
								<span className="text-red-600 dark:text-red-400">
									-{diffStats.deletions}
								</span>
								<div className="flex items-center gap-0.5">
									{Array.from({ length: 5 }, (_, i) => {
										const ratio =
											diffStats.insertions /
											(diffStats.insertions + diffStats.deletions);
										const isGreen = i < Math.round(ratio * 5);
										return (
											<div
												key={i}
												className={cn(
													"w-2 h-2 rounded-sm",
													isGreen ? "bg-green-600" : "bg-red-600",
												)}
											/>
										);
									})}
								</div>
							</div>
						)}
					</div>
				</div>
				{activeTab === "changes" &&
					workspace &&
					workspace.branch_name !== defaultTargetBranch && (
						<div className="px-4 py-2 border-b border-border flex">
							<TooltipProvider>
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											variant={
												showCommittedChanges && hasWorkspaceCommits
													? "default"
													: "outline"
											}
											size="sm"
											disabled={!hasWorkspaceCommits}
											onClick={() =>
												setShowCommittedChanges(!showCommittedChanges)
											}
											className={
												showCommittedChanges && hasWorkspaceCommits
													? "bg-blue-500/20 hover:bg-blue-500/30 text-blue-700 dark:text-blue-300"
													: ""
											}
										>
											{showCommittedChanges && hasWorkspaceCommits ? (
												<Eye className="w-4 h-4 mr-1.5" />
											) : (
												<EyeOff className="w-4 h-4 mr-1.5" />
											)}
											Committed
										</Button>
									</TooltipTrigger>
									<TooltipContent>
										<p>
											{!hasWorkspaceCommits
												? "No committed changes"
												: showCommittedChanges
													? "Hide committed changes"
													: "Show committed changes"}
										</p>
									</TooltipContent>
								</Tooltip>
							</TooltipProvider>
						</div>
					)}
				<div className="flex-1 overflow-auto">
					{activeTab === "overview" ? (
						showFileBrowserInCode ? (
							<div className="flex flex-col h-full">
								<div className="px-4 pt-3 pb-2 border-b border-border">
									<button
										type="button"
										onClick={() => setShowFileBrowserInCode(false)}
										className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
									>
										<ChevronLeft className="w-4 h-4" />
										Back
									</button>
								</div>
								<div className="flex-1 overflow-hidden">
									<FileBrowser
										workspace={workspace}
										repoPath={effectiveRepoPath}
										initialSelectedFile={initialSelectedFileForBrowser}
										initialExpandedDir={initialExpandedDir}
										onCreateAgentWithComment={handleCreateAgentWithComment}
									/>
								</div>
							</div>
						) : (
							<div className="flex h-full">
								{/* LEFT: Files + README */}
								<div className="flex-1 overflow-auto border-r border-border">
									<div className="p-4 space-y-4">
										{overviewPending && !overviewData && (
											<div
												className="space-y-4"
												data-testid="workspace-overview-skeleton"
											>
												<div className="h-10 rounded-lg bg-muted/50 animate-pulse" />
												<div className="h-10 rounded-lg bg-muted/50 animate-pulse" />
												<div className="border rounded-lg p-4 space-y-2">
													<div className="h-4 w-32 rounded bg-muted/50 animate-pulse" />
													<div className="h-3 rounded bg-muted/40 animate-pulse" />
													<div className="h-3 w-11/12 rounded bg-muted/40 animate-pulse" />
													<div className="h-3 w-10/12 rounded bg-muted/40 animate-pulse" />
												</div>
											</div>
										)}
										{/* Conflicts Alert */}
										{conflictCount > 0 && (
											<div
												role="alert"
												className="border border-destructive/30 rounded-md bg-destructive/5 p-4"
											>
												<div className="flex items-start gap-3">
													<AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
													<div className="flex-1">
														<h3 className="font-medium text-destructive">
															{conflictCount}{" "}
															{conflictCount === 1 ? "conflict" : "conflicts"}{" "}
															detected
														</h3>
														<p className="text-sm text-muted-foreground mt-1">
															Some files have conflicts that need to be resolved
														</p>
													</div>
													<Button
														variant="outline"
														size="sm"
														onClick={() => setActiveTab("changes")}
														className="border-destructive/30 text-destructive hover:bg-destructive/10"
													>
														View conflicts
													</Button>
												</div>
											</div>
										)}
										{/* Task Input */}
										<TaskInput
											repoPath={effectiveRepoPath}
											workspaceId={workspace?.id ?? null}
											workspacePath={workspace?.workspace_path ?? null}
											workingDirectory={workingDirectory}
											focusRequest={taskInputFocusRequest}
											onSessionCreated={onSessionCreated}
										/>
										{/* Stack */}
										{workspace && workspaceStatusData?.target != null && (
											<div className="border rounded-lg">
												<WorkspaceStackPanel
													repoPath={effectiveRepoPath}
													workspace={workspace}
													defaultBranch={defaultTargetBranch}
													onSelectWorkspace={onNavigateToWorkspace}
												/>
											</div>
										)}
										{/* File Search Input */}
										<div className="flex justify-end">
											<button
												type="button"
												onClick={onOpenFilePicker}
												className="flex items-center gap-3 px-4 py-2 border border-border rounded-lg bg-background hover:bg-muted/30 transition-colors text-left w-full max-w-xs"
											>
												<Search className="w-4 h-4 text-muted-foreground" />
												<span className="flex-1 text-sm text-muted-foreground">
													Go to file
												</span>
												<KbdGroup className="shrink-0">
													<Kbd>⌘ + P</Kbd>
												</KbdGroup>
											</button>
										</div>

										{/* File Listing */}
										<div className="border rounded-lg divide-y divide-border">
											{displayedEntries.map((entry) => (
												<button
													key={entry.path}
													type="button"
													onClick={() => handleOverviewEntryClick(entry)}
													className="flex items-center gap-3 px-4 py-1 text-sm w-full hover:bg-muted/60 transition text-left"
												>
													{entry.is_directory ? (
														<Folder className="w-4 h-4 text-blue-500" />
													) : (
														<File className="w-4 h-4 text-muted-foreground" />
													)}
													<span
														className="flex-1 font-mono"
														style={{ fontSize: `${fontSize}px` }}
													>
														{entry.name}
													</span>
													<StatusPip status={getEntryStatus(entry)} />
												</button>
											))}
											{!overviewPending && rootEntries.length === 0 && (
												<div className="px-4 py-8 text-center text-sm text-muted-foreground">
													No files found
												</div>
											)}
										</div>

										{/* README Section */}
										<div className="border rounded-lg p-6">
											{readmeContent ? (
												<>
													<h2 className="text-lg font-semibold mb-4">
														README.md
													</h2>
													<MarkdownContent
														content={readmeContent}
														resolveImageSrc={(src) =>
															resolveReadmeImageSrc(src, readmeBaseDir)
														}
													/>
												</>
											) : (
												<div className="text-muted-foreground text-sm text-center py-4">
													No README.md found
												</div>
											)}
										</div>
									</div>
								</div>

								{/* RIGHT: Commit History (fixed width matching sidebar) */}
								<div className="w-[240px] shrink-0 bg-muted/20">
									<LinearCommitHistory
										repoPath={effectiveRepoPath}
										workspaceId={workspace?.id ?? null}
										onCommitClick={(changeId) => {
											setScrollToCommitId(changeId);
											setActiveTab("commits");
										}}
										onCommitsLoaded={handleCommitsLoaded}
									/>
								</div>
							</div>
						)
					) : activeTab === "commits" ? (
						<CommitDiffViewer
							repoPath={effectiveRepoPath}
							workspaceId={workspace?.id ?? null}
							scrollToCommitId={scrollToCommitId}
							onScrollComplete={() => setScrollToCommitId(null)}
							onCommitAbandoned={() => {}}
							onCreateAgentWithComment={handleCreateAgentWithComment}
							onMoveCommitToNewWorkspace={
								onMoveCommitToNewWorkspace
									? (commit) => onMoveCommitToNewWorkspace(commit, workspace)
									: undefined
							}
							onMoveCommitToExistingWorkspace={
								onMoveCommitToExistingWorkspace
									? (commit) =>
											onMoveCommitToExistingWorkspace(commit, workspace)
									: undefined
							}
							onViewTentativeChanges={handleViewTentativeChanges}
							onDeleteTentativeChanges={handleDeleteTentativeChanges}
						/>
					) : (
						<ChangesDiffViewer
							key={`changes-${workingDirectory}`}
							ref={changesDiffViewerRef}
							workspacePath={workingDirectory}
							workspaceId={workspace?.id}
							repoPath={effectiveRepoPath}
							onChangedFilesChange={handleChangedFilesUpdate}
							onRefreshingChange={handleRefreshingChange}
							initialSelectedFile={initialSelectedFile}
							conflictedFiles={normalizedConflictedFiles}
							onCreateAgentWithReview={handleCreateAgentWithReview}
							showCommittedChanges={
								workspace && workspace.branch_name !== defaultTargetBranch
									? showCommittedChanges
									: false
							}
							onMoveFilesToNewWorkspace={
								onMoveFilesToNewWorkspace
									? (files) => onMoveFilesToNewWorkspace(files, workspace)
									: undefined
							}
						/>
					)}
				</div>
			</div>
		) : (
			<div className="h-full flex items-center justify-center text-center p-6 text-sm text-muted-foreground">
				Configure a workspace or repository path to manage commits.
			</div>
		);

		// Display branch name as title: workspace branch if available, otherwise main repo branch
		const branchTitle = workspace?.branch_name || mainRepoBranch || "main";
		const isHomeRepo = !workspace;
		const hasSyncChanges =
			!!syncStatus && (syncStatus.ahead > 0 || syncStatus.behind > 0);

		const workspaceMetadata = workspace?.metadata
			? (() => {
					try {
						return JSON.parse(workspace.metadata) as {
							title?: string;
							description?: string;
						};
					} catch {
						return null;
					}
				})()
			: null;
		const workspaceTitle =
			workspace?.title ||
			workspaceMetadata?.title ||
			workspace?.branch_name ||
			null;
		const workspaceDescription =
			workspace?.description || workspaceMetadata?.description || null;

		// Truncate description at 100 characters
		const truncatedDescription =
			workspaceDescription && workspaceDescription.length > 100
				? `${workspaceDescription.substring(0, 100)}...`
				: workspaceDescription;

		const isTruncated =
			workspaceDescription && workspaceDescription.length > 100;

		return (
			<>
				<div className="h-full w-full flex flex-col bg-background">
					<div
						className="border-b p-2 flex flex-col gap-1 flex-shrink-0"
						data-testid="show-workspace-header"
					>
						{/* Row 1: Branch name */}
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2 min-w-0">
								<GitBranch className="w-4 h-4 text-muted-foreground shrink-0" />

								{workspace && (
									<span
										className="text-sm font-semibold font-mono truncate min-w-0 max-w-[220px]"
										title={branchTitle}
									>
										{branchTitle}
									</span>
								)}
								{workspace && workspace.branch_name !== defaultBranch && (
									<>
										<ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
										<TargetBranchSelector
											branches={availableBranches}
											loading={branchesLoading}
											targetBranch={targetBranch}
											onSelect={handleTargetBranchSelect}
											onOpenChange={(open) => {
												if (open) {
													void onLoadAvailableBranches?.();
												}
											}}
											disabled={rebasing}
										/>
									</>
								)}
								{workspace && onCreateStackedWorkspace && (
									<TooltipProvider delayDuration={200}>
										<Tooltip>
											<TooltipTrigger asChild>
												<Button
													variant="default"
													size="sm"
													onClick={onCreateStackedWorkspace}
													disabled={rebasing || conflictCount > 0}
												>
													<Layers2 className="w-4 h-4" />
													Stack
												</Button>
											</TooltipTrigger>
											<TooltipContent>
												{rebasing
													? "Rebasing in progress..."
													: conflictCount > 0
														? `Cannot stack: ${conflictCount} conflict${
																conflictCount === 1 ? "" : "s"
															} detected`
														: `Create stacked workspace from ${branchTitle}`}
											</TooltipContent>
										</Tooltip>
									</TooltipProvider>
								)}
								{!workspace && (
									<>
										<button
											type="button"
											onClick={onOpenBranchSwitcher}
											className="text-sm font-semibold font-mono hover:underline cursor-pointer truncate min-w-0 max-w-[220px]"
											title={branchTitle}
										>
											{branchTitle}
										</button>
										{/* Target branch label + rebase button for non-default home repo branches */}
										{isHomeRepo && branchTitle !== defaultBranch && (
											<>
												<ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
												<span
													className="text-sm font-mono text-muted-foreground truncate min-w-0 max-w-[220px]"
													title={defaultBranch}
												>
													{defaultBranch}
												</span>
												{homeRepoTargetAheadCount > 0 && (
													<>
														{homeRebaseDryRun?.would_conflict && (
															<TooltipProvider delayDuration={200}>
																<Tooltip>
																	<TooltipTrigger asChild>
																		<span className="flex items-center text-yellow-600 dark:text-yellow-400">
																			<AlertTriangle className="w-4 h-4" />
																		</span>
																	</TooltipTrigger>
																	<TooltipContent>
																		<p className="font-medium mb-1">
																			Potential conflicts detected
																		</p>
																		{homeRebaseDryRun.conflicted_files.length >
																			0 && (
																			<ul className="text-xs space-y-0.5">
																				{homeRebaseDryRun.conflicted_files.map(
																					(f) => (
																						<li key={f} className="font-mono">
																							{f}
																						</li>
																					),
																				)}
																			</ul>
																		)}
																	</TooltipContent>
																</Tooltip>
															</TooltipProvider>
														)}
														<TooltipProvider delayDuration={200}>
															<Tooltip>
																<TooltipTrigger asChild>
																	<Button
																		variant="outline"
																		size="sm"
																		onClick={handleHomeRebase}
																		disabled={homeRebasing}
																		className="gap-1 px-2 py-1"
																	>
																		{homeRebasing ? (
																			<Loader2 className="w-4 h-4 animate-spin" />
																		) : (
																			<GitCompareArrows className="w-4 h-4" />
																		)}
																		Rebase
																	</Button>
																</TooltipTrigger>
																<TooltipContent>
																	{homeRebasing
																		? "Rebasing..."
																		: `Rebase ${branchTitle} onto ${defaultBranch} (${homeRepoTargetAheadCount} new commit${
																				homeRepoTargetAheadCount === 1
																					? ""
																					: "s"
																			})`}
																</TooltipContent>
															</Tooltip>
														</TooltipProvider>
													</>
												)}
											</>
										)}
										{/* Stack button for home repo */}
										{onCreateStackedWorkspace && (
											<TooltipProvider delayDuration={200}>
												<Tooltip>
													<TooltipTrigger asChild>
														<Button
															variant="default"
															size="sm"
															onClick={onCreateStackedWorkspace}
															className="gap-1 px-2 py-1"
														>
															<Layers2 className="w-4 h-4" />
															Stack
														</Button>
													</TooltipTrigger>
													<TooltipContent>
														{`Create stacked workspace from ${branchTitle}`}
													</TooltipContent>
												</Tooltip>
											</TooltipProvider>
										)}
									</>
								)}
							</div>
							<div className="flex items-center gap-2">
								{/* Create PR also pushes first when the GitHub branch is new. */}
								{workspace &&
									workspace.branch_name !== defaultBranch &&
									effectiveRepoPath && (
										<>
											{!workspace.not_on_remote && (
												<ViewPrButton
													repoPath={effectiveRepoPath}
													branchName={workspace.branch_name}
													onViewInApp={onViewPrInApp}
												/>
											)}
											<CreatePrButtonGroup
												repoPath={effectiveRepoPath}
												workspace={workspace}
												baseBranch={targetBranch ?? defaultTargetBranch}
												onPush={handlePushToRemote}
											/>
										</>
									)}

								{/* Sync control - status + icon in one clickable button */}
								{(!workspace || !workspace.not_on_remote) &&
									syncStatus &&
									(isHomeRepo || hasSyncChanges) && (
										<TooltipProvider delayDuration={200}>
											<Tooltip>
												<TooltipTrigger asChild>
													<Button
														variant="ghost"
														size="sm"
														className="h-6 gap-1 px-2 text-xs text-muted-foreground"
														onClick={handleSync}
														disabled={!!actionPending || !hasSyncChanges}
													>
														{(isHomeRepo || syncStatus.behind > 0) && (
															<span className="flex items-center">
																↓{syncStatus.behind}
															</span>
														)}
														{(isHomeRepo || syncStatus.ahead > 0) && (
															<span className="flex items-center">
																↑{syncStatus.ahead}
															</span>
														)}
														<RefreshCw
															className={cn(
																"w-4 h-4",
																actionPending === "sync" && "animate-spin",
															)}
														/>
													</Button>
												</TooltipTrigger>
												<TooltipContent>
													{hasSyncChanges
														? "Sync with remote (fetch and push)"
														: "No commits to sync"}
												</TooltipContent>
											</Tooltip>
										</TooltipProvider>
									)}
								{/* Merge queue button. Hidden entirely until the repo has
								    opted into the merge queue in the GitHub panel. */}
								{FEATURES.mergeQueue &&
									queueEnabled === true &&
									workspace &&
									workspace.branch_name !== defaultBranch &&
									!workspace.not_on_remote && (
										<TooltipProvider delayDuration={200}>
											<Tooltip>
												<TooltipTrigger asChild>
													<Button
														variant={
															queueStatus && queueStatus.status !== "dequeued"
																? "secondary"
																: "outline"
														}
														size="sm"
														className="gap-1"
														disabled={enqueue.isPending || dequeue.isPending}
														onClick={async () => {
															const isInQueue =
																!!queueStatus &&
																!["merged", "failed", "dequeued"].includes(
																	queueStatus.status,
																);
															try {
																if (isInQueue) {
																	await dequeue.mutateAsync();
																	addToast({
																		title: "Removed from merge queue",
																		type: "success",
																	});
																} else {
																	await enqueue.mutateAsync();
																	addToast({
																		title: "Added to merge queue",
																		type: "success",
																	});
																}
															} catch (err) {
																addToast({
																	title: "Queue error",
																	description: (err as Error).message,
																	type: "error",
																});
															}
														}}
													>
														<GitMerge className="w-4 h-4" />
														{queueStatus &&
														!["merged", "failed", "dequeued"].includes(
															queueStatus.status,
														)
															? "Queued"
															: "Add to Queue"}
													</Button>
												</TooltipTrigger>
												<TooltipContent>
													{queueStatus
														? queueStatus.status === "merged"
															? "Merged via queue"
															: queueStatus.status === "failed"
																? `Failed: ${queueStatus.failure_reason ?? "unknown"}`
																: `In merge queue at position ${queueStatus.position}`
														: "Add this branch to the merge queue"}
												</TooltipContent>
											</Tooltip>
										</TooltipProvider>
									)}
								{/* Merge button moved here */}
								{workspace && workspace.branch_name !== defaultBranch && (
									<TooltipProvider delayDuration={200}>
										<Tooltip>
											<TooltipTrigger asChild>
												<div className="inline-flex">
													<Button
														variant="default"
														size="sm"
														onClick={onOpenMergePreview}
														disabled={rebasing || conflictCount > 0}
														className="gap-1 bg-green-600 hover:bg-green-700"
													>
														<GitCompareArrows className="w-4 h-4" />
														Merge...
													</Button>
												</div>
											</TooltipTrigger>
											{(rebasing || conflictCount > 0) && (
												<TooltipContent>
													{rebasing
														? "Rebasing in progress..."
														: `Cannot merge: ${conflictCount} conflict${
																conflictCount === 1 ? "" : "s"
															} detected`}
												</TooltipContent>
											)}
										</Tooltip>
									</TooltipProvider>
								)}
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button
											variant="ghost"
											size="sm"
											className="px-1"
											disabled={!!actionPending}
										>
											<MoreVertical className="w-4 h-4" />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end" sideOffset={4}>
										<DropdownMenuItem
											onSelect={(e) => {
												e.preventDefault();
												handlePushToRemote();
											}}
										>
											<Upload className="w-4 h-4 mr-2" />
											Push to remote
										</DropdownMenuItem>
										{workspace && (
											<DropdownMenuItem
												onSelect={(e) => {
													e.preventDefault();
													handleForceRebaseWorkspace();
												}}
											>
												<RefreshCw className="w-4 h-4 mr-2" />
												Force Rebase Workspace
											</DropdownMenuItem>
										)}
										{workspace && onDeleteWorkspace && (
											<>
												<DropdownMenuSeparator />
												<DropdownMenuItem
													onSelect={() => onDeleteWorkspace(workspace)}
													className="text-destructive focus:text-destructive"
												>
													<Trash2 className="w-4 h-4 mr-2" />
													Delete Workspace
												</DropdownMenuItem>
											</>
										)}
									</DropdownMenuContent>
								</DropdownMenu>
							</div>
						</div>
						{/* Row 2: Title (if workspace title exists) */}
						{workspace && workspaceTitle && workspaceTitle !== branchTitle && (
							<div className="flex items-center px-1 mt-2">
								<h1 className="text-sm font-medium text-foreground">
									{workspaceTitle}
								</h1>
							</div>
						)}
						{/* Row 3: Description (if workspace description exists) */}
						{workspace && workspaceDescription && (
							<div className="flex items-center px-1">
								{isTruncated ? (
									<Popover>
										<PopoverTrigger asChild>
											<span className="text-sm text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
												{truncatedDescription}
											</span>
										</PopoverTrigger>
										<PopoverContent className="w-96">
											<p className="text-sm">{workspaceDescription}</p>
										</PopoverContent>
									</Popover>
								) : (
									<span className="text-sm text-muted-foreground">
										{truncatedDescription}
									</span>
								)}
							</div>
						)}
					</div>

					<div className="flex-1 flex overflow-hidden min-h-0">
						<div className="w-full flex flex-col overflow-hidden">
							{executionPanel}
						</div>
					</div>
				</div>
				<WorkspaceBookmarkConflictModal
					conflict={bookmarkConflict}
					open={conflictModalOpen && !!bookmarkConflict}
					onClose={() => setConflictModalOpen(false)}
					onResolve={handleResolveBookmarkConflict}
					resolving={resolvingBookmarkConflict}
				/>
			</>
		);
	},
);
