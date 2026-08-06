import { DragDropContext, Droppable, type DropResult } from "@hello-pangea/dnd";
import { useQuery } from "@tanstack/react-query";
import {
	GitBranch,
	Github,
	Home,
	Search,
	Settings,
	Trash2,
} from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
import {
	useGitRemoteInfo,
	useMergeQueueEnabled,
	usePrStatusPolling,
} from "../hooks/useMergeQueueStatus";
import {
	getWorkspaceStatus,
	getWorkspaces,
	listWorkspaceStatuses,
	type Workspace,
} from "../lib/api";
import type {
	PrInfo,
	QueueEntryStatus,
	WorkspaceSidebarStatus,
} from "../lib/api-types";
import { FEATURES } from "../lib/features";
import { supabase } from "../lib/supabase";
import {
	buildWorkspaceTree,
	flattenWorkspaceTree,
	getDescendants,
	getEntireStack,
} from "../lib/workspace-tree";
import { RenameWorkspaceDialog } from "./RenameWorkspaceDialog";
import { TerminalSessionsSidebar } from "./TerminalSessionsSidebar";
import { type TerminalSessionSummary } from "./terminal/types";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "./ui/context-menu";
import { Kbd, KbdGroup } from "./ui/kbd";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "./ui/tooltip";
import {
	PathContextMenuItems,
	WorkspaceSidebarItem,
} from "./WorkspaceSidebarItem";

interface WorkspaceSidebarProps {
	repoPath?: string;
	homeRepoDisplayRef?: string | null;
	selectedWorkspaceId?: number | null;
	selectedWorkspaceIds?: Set<number>;
	onWorkspaceClick?: (workspace: Workspace) => void;
	onWorkspaceMultiSelect?: (
		workspace: Workspace | null,
		event: React.MouseEvent,
	) => void;
	onBulkDelete?: () => void;
	onDeleteWorkspace?: (workspace: Workspace) => void;
	openSettings?: (tab?: string) => void;
	navigateToDashboard?: () => void;
	onOpenCommandPalette?: () => void;
	onOpenBranchSwitcher?: () => void;
	onOpenGitHub?: () => void;
	currentPage?: string;
	onAddBefore?: (workspace: Workspace) => void;
	onAddAfter?: (workspace: Workspace) => void;
	onMoveWorkspace?: (workspace: Workspace, targetBranch: string | null) => void;
	onSelectStack?: (workspaceIds: Set<number>) => void;
	onStartAgent?: (workspace: Workspace) => void;
	onStartShell?: (workspace: Workspace) => void;
	terminalSessions?: TerminalSessionSummary[];
	onFocusTerminalSession?: (id: string) => void;
	onCloseTerminalSession?: (id: string) => void;
	onCloseIdleTerminalSessions?: () => void;
	onCloseAllTerminalSessions?: () => void;
	onCreateAgentTerminal?: () => void;
	onCreateShellTerminal?: () => void;
}

export const WorkspaceSidebar: React.FC<WorkspaceSidebarProps> = memo(
	({
		repoPath,
		homeRepoDisplayRef,
		selectedWorkspaceId,
		selectedWorkspaceIds,
		onWorkspaceClick,
		onWorkspaceMultiSelect,
		onBulkDelete,
		onDeleteWorkspace,
		openSettings,
		onOpenCommandPalette,
		onOpenBranchSwitcher,
		onOpenGitHub,
		currentPage,
		onAddAfter,
		onMoveWorkspace,
		onSelectStack,
		onStartAgent,
		onStartShell,
		terminalSessions,
		onFocusTerminalSession,
		onCloseTerminalSession,
		onCloseIdleTerminalSessions,
		onCloseAllTerminalSessions,
		onCreateAgentTerminal,
		onCreateShellTerminal,
	}) => {
		const {
			data: workspaces = [],
			isPending: workspacesPending,
			isSuccess: workspacesLoaded,
		} = useQuery({
			queryKey: ["workspaces", repoPath],
			queryFn: () => getWorkspaces(repoPath || ""),
			enabled: !!repoPath,
			placeholderData: (previousData) => previousData,
		});

		const { data: workspaceStatuses = [] } = useQuery({
			queryKey: ["workspace-statuses", repoPath],
			queryFn: async () => {
				const baseStatuses = await listWorkspaceStatuses(repoPath || "");
				return Promise.all(
					baseStatuses.map(async (status) => {
						if (status.has_conflicts) return status;
						const detailed = await getWorkspaceStatus(
							repoPath || "",
							status.current.id,
						);
						return {
							...status,
							has_conflicts: detailed.has_conflicts,
						};
					}),
				);
			},
			enabled: !!repoPath && workspacesLoaded,
			placeholderData: (previousData) => previousData,
		});

		const { data: remoteInfo } = useGitRemoteInfo(repoPath);
		const { data: queueEnabled } = useMergeQueueEnabled(repoPath);
		// Single Rust-backed cache for all workspace PR statuses — no per-row
		// `gh pr view` polling from the WebView.
		const { data: prStatusesByBranch = {} } = usePrStatusPolling(repoPath);
		const { data: branchQueueStatuses } = useQuery({
			queryKey: ["repo-branch-queue-statuses", remoteInfo?.full_name],
			queryFn: async () => {
				const { data } = await supabase.rpc("get_repo_branch_queue_statuses", {
					p_repo_full_name: remoteInfo!.full_name,
				});
				const map = new Map<string, QueueEntryStatus>();
				for (const row of (data ?? []) as {
					branch_name: string;
					status: string;
				}[]) {
					map.set(row.branch_name, row.status as QueueEntryStatus);
				}
				return map;
			},
			enabled: FEATURES.mergeQueue && queueEnabled === true && !!remoteInfo,
			refetchInterval: 30_000,
		});

		const statuses = useMemo<WorkspaceSidebarStatus[]>(() => {
			const statusById = new Map(
				(workspaceStatuses ?? []).map((status) => [status.current.id, status]),
			);
			return (workspaces ?? []).map((workspace) => {
				const status = statusById.get(workspace.id);
				return status ?? { current: workspace, has_conflicts: false };
			});
		}, [workspaceStatuses, workspaces]);
		const workspacesForSelection = useMemo(
			() => statuses.map((s) => s.current),
			[statuses],
		);
		const [renameTarget, setRenameTarget] = useState<Workspace | null>(null);

		const flattenedNodes = useMemo(() => {
			const tree = buildWorkspaceTree(statuses);
			return flattenWorkspaceTree(tree);
		}, [statuses]);

		const handleContainerClick = useCallback(
			(e: React.MouseEvent) => {
				if (
					e.target === e.currentTarget &&
					selectedWorkspaceIds &&
					selectedWorkspaceIds.size > 0 &&
					onWorkspaceMultiSelect
				) {
					onWorkspaceMultiSelect(
						null as Parameters<NonNullable<typeof onWorkspaceMultiSelect>>[0],
						e,
					);
				}
			},
			[selectedWorkspaceIds, onWorkspaceMultiSelect],
		);

		const handleDoubleClick = useCallback(
			(workspace: Workspace, e: React.MouseEvent) => {
				if (!onSelectStack) return;
				e.stopPropagation();

				if (e.shiftKey) {
					const descendants = getDescendants(
						workspacesForSelection,
						workspace.branch_name,
					);
					const ids = new Set([workspace.id, ...descendants.map((w) => w.id)]);
					onSelectStack(ids);
					return;
				}

				const stack = getEntireStack(
					workspacesForSelection,
					workspace.branch_name,
				);
				onSelectStack(new Set(stack.map((w) => w.id)));
			},
			[workspacesForSelection, onSelectStack],
		);

		const handleDragEnd = useCallback(
			(result: DropResult) => {
				if (!onMoveWorkspace) return;

				const draggedId = parseInt(result.draggableId, 10);
				const draggedWorkspace = workspacesForSelection.find(
					(w) => w.id === draggedId,
				);
				if (!draggedWorkspace) return;

				if (result.combine) {
					const targetWorkspace = workspacesForSelection.find(
						(w) => String(w.id) === result.combine!.draggableId,
					);
					if (targetWorkspace && targetWorkspace.id !== draggedWorkspace.id) {
						onMoveWorkspace(draggedWorkspace, targetWorkspace.branch_name);
					}
					return;
				}

				if (result.destination) {
					onMoveWorkspace(draggedWorkspace, null);
				}
			},
			[workspacesForSelection, onMoveWorkspace],
		);

		const repoName = repoPath
			? repoPath.split("/").filter(Boolean).pop() || "Repository"
			: "Repository";

		// GitHub/Settings are their own nav destinations — don't keep home/workspace
		// selection highlighted alongside them.
		const workspaceSelectionActive =
			currentPage !== "github" && currentPage !== "settings";
		const isHomeSelected =
			workspaceSelectionActive && selectedWorkspaceId === null;
		const activeSelectedWorkspaceId = workspaceSelectionActive
			? selectedWorkspaceId
			: undefined;
		const activeSelectedWorkspaceIds = workspaceSelectionActive
			? selectedWorkspaceIds
			: undefined;

		return (
			<TooltipProvider delayDuration={200} skipDelayDuration={100}>
				<div className="group/sidebar w-[280px] bg-sidebar border-r border-border flex flex-col h-screen">
					<div className="flex items-center gap-2 mx-2 mt-2">
						<button
							onClick={onOpenCommandPalette}
							className="flex items-center gap-2 flex-1 px-3 py-1.5 rounded-lg border border-border bg-muted/50 hover:bg-muted text-muted-foreground transition-colors"
						>
							<Search className="w-4 h-4 shrink-0" />
							<span className="flex-1 text-left truncate">{repoName}</span>
							<KbdGroup className="shrink-0">
								<Kbd>⌘ + K</Kbd>
							</KbdGroup>
						</button>
						{openSettings && (
							<Tooltip>
								<TooltipTrigger asChild>
									<button
										type="button"
										onClick={() => openSettings("application")}
										className={`h-9 w-9 rounded-lg hover:bg-muted flex items-center justify-center transition-colors border border-border ${
											currentPage === "settings"
												? "bg-primary/20"
												: "bg-muted/50"
										}`}
										aria-label="Settings"
									>
										<Settings
											className={`w-4 h-4 ${
												currentPage === "settings"
													? "text-primary"
													: "text-muted-foreground"
											}`}
										/>
									</button>
								</TooltipTrigger>
								<TooltipContent side="bottom">Settings</TooltipContent>
							</Tooltip>
						)}
					</div>

					<div
						className="pl-1 pr-2 py-2 space-y-1 min-h-[120px] flex-1 overflow-y-auto select-none"
						onClick={handleContainerClick}
					>
						<ContextMenu>
							<Tooltip>
								<ContextMenuTrigger asChild>
									<TooltipTrigger asChild>
										<div
											data-testid="home-repo-row"
											className={`relative flex items-center text-sm tracking-wide px-2 py-1 rounded-md transition-colors cursor-pointer ${
												isHomeSelected ? "bg-primary/20" : "hover:bg-muted/50"
											}`}
											onClick={(e) => {
												if (
													selectedWorkspaceIds &&
													selectedWorkspaceIds.size > 0 &&
													onWorkspaceMultiSelect
												) {
													onWorkspaceMultiSelect(
														null as Parameters<
															NonNullable<typeof onWorkspaceMultiSelect>
														>[0],
														e,
													);
													return;
												}
												onWorkspaceClick?.(undefined as unknown as Workspace);
											}}
										>
											<Home
												className={`w-3 h-3 mr-1 shrink-0 ${
													isHomeSelected
														? "text-primary"
														: "text-muted-foreground"
												}`}
											/>
											<span
												className={`flex-1 min-w-0 truncate font-mono ${
													isHomeSelected
														? "text-primary font-medium"
														: "text-muted-foreground"
												}`}
												title={homeRepoDisplayRef || "…"}
											>
												{homeRepoDisplayRef || "…"}
											</span>
										</div>
									</TooltipTrigger>
								</ContextMenuTrigger>
								<TooltipContent side="right" className="font-mono">
									<div className="flex items-center gap-1.5">
										<GitBranch className="w-3 h-3" />
										<span>{homeRepoDisplayRef || "…"}</span>
									</div>
								</TooltipContent>
							</Tooltip>
							<ContextMenuContent>
								{onOpenBranchSwitcher && (
									<>
										<ContextMenuItem onClick={onOpenBranchSwitcher}>
											<GitBranch className="w-4 h-4 mr-2" />
											Switch Branch...
										</ContextMenuItem>
										<ContextMenuSeparator />
									</>
								)}
								<PathContextMenuItems
									relativePath="."
									fullPath={repoPath || ""}
								/>
							</ContextMenuContent>
						</ContextMenu>

						{onOpenGitHub && (
							<button
								type="button"
								data-testid="github-sidebar-item"
								onClick={onOpenGitHub}
								className={`relative flex items-center text-sm tracking-wide px-2 py-1 rounded-md transition-colors cursor-pointer w-full ${
									currentPage === "github"
										? "bg-primary/20"
										: "hover:bg-muted/50"
								}`}
								aria-label="GitHub"
							>
								<Github
									className={`w-3 h-3 mr-1 shrink-0 ${
										currentPage === "github"
											? "text-primary"
											: "text-muted-foreground"
									}`}
								/>
								<span
									className={`${
										currentPage === "github"
											? "text-primary font-medium"
											: "text-muted-foreground"
									}`}
								>
									Github
								</span>
							</button>
						)}

						{workspaces.length > 0 && (
							<div className="my-2 border-t border-border" />
						)}

						<DragDropContext onDragEnd={handleDragEnd}>
							<Droppable droppableId="sidebar-root" isCombineEnabled>
								{(droppableProvided) => (
									<div
										className="space-y-1"
										ref={droppableProvided.innerRef}
										{...droppableProvided.droppableProps}
									>
										<h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest px-2 py-1">
											Workspaces
										</h4>
										{workspacesPending &&
											flattenedNodes.length === 0 &&
											Array.from({ length: 6 }, (_, index) => (
												<div
													key={`workspace-skeleton-${index}`}
													className="h-7 mx-2 rounded bg-muted/50 animate-pulse"
												/>
											))}
										{flattenedNodes.map((node, index) => (
											<WorkspaceSidebarItem
												key={node.status.current.id}
												node={node}
												index={index}
												repoPath={repoPath}
												selectedWorkspaceId={activeSelectedWorkspaceId}
												selectedWorkspaceIds={activeSelectedWorkspaceIds}
												onWorkspaceClick={onWorkspaceClick}
												onWorkspaceMultiSelect={onWorkspaceMultiSelect}
												onAddAfter={onAddAfter}
												onStartAgent={onStartAgent}
												onStartShell={onStartShell}
												onDeleteWorkspace={onDeleteWorkspace}
												onRenameWorkspace={setRenameTarget}
												onDoubleClick={handleDoubleClick}
												queueStatus={branchQueueStatuses?.get(
													node.status.current.branch_name,
												)}
												prInfo={
													(prStatusesByBranch as Record<string, PrInfo | null>)[
														node.status.current.branch_name
													] ?? null
												}
												hasRemote={!!remoteInfo}
											/>
										))}
										{droppableProvided.placeholder}
										{selectedWorkspaceIds && selectedWorkspaceIds.size > 0 && (
											<button
												type="button"
												onClick={onBulkDelete}
												className="flex items-center justify-center gap-1 w-full px-2 py-1.5 text-destructive hover:bg-destructive/10 rounded-md transition-colors"
											>
												<Trash2 className="w-3 h-3" />
												<span>
													Delete {selectedWorkspaceIds.size} workspace
													{selectedWorkspaceIds.size > 1 ? "s" : ""}
												</span>
											</button>
										)}
									</div>
								)}
							</Droppable>
						</DragDropContext>
					</div>
					<TerminalSessionsSidebar
						sessions={terminalSessions ?? []}
						onFocus={onFocusTerminalSession}
						onClose={onCloseTerminalSession}
						onCloseIdle={onCloseIdleTerminalSessions}
						onCloseAll={onCloseAllTerminalSessions}
						onCreateAgent={onCreateAgentTerminal}
						onCreateShell={onCreateShellTerminal}
					/>
				</div>
				{renameTarget && repoPath && (
					<RenameWorkspaceDialog
						open={!!renameTarget}
						onOpenChange={(open) => {
							if (!open) setRenameTarget(null);
						}}
						repoPath={repoPath}
						workspace={renameTarget}
						onSuccess={() => setRenameTarget(null)}
					/>
				)}
			</TooltipProvider>
		);
	},
);
