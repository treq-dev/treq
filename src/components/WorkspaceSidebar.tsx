import { DragDropContext, Droppable, type DropResult } from "@hello-pangea/dnd";
import { Archive, Github, ListTodo, Search } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import {
  useGitRemoteInfo,
  useMergeQueueEnabled,
  usePrStatusPolling,
} from "../hooks/useMergeQueueStatus";
import { useWorkspaceSidebarMultiSelect } from "../hooks/useWorkspaceSidebarMultiSelect";
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
import type { ChangeFilesMoveRequest } from "../lib/change-file-drag";
import { FEATURES } from "../lib/features";
import { supabase } from "../lib/supabase";
import { pollMs } from "../lib/swr-cache";
import {
  buildWorkspaceTree,
  flattenWorkspaceTree,
  getDescendants,
  getEntireStack,
} from "../lib/workspace-tree";
import { isWorkspaceHidden } from "../lib/workspace-utils";
import { useRepositoryCacheKey } from "../lib/active-repository-context";
import { usePreviewFeature } from "../stores/featurePreviewStore";
import { HomeRepoSidebarRow } from "./HomeRepoSidebarRow";
import { HiddenWorkspacesToggle } from "./HiddenWorkspacesToggle";
import { RenameWorkspaceDialog } from "./RenameWorkspaceDialog";
import { TerminalSessionsSidebar } from "./TerminalSessionsSidebar";
import type { TerminalSessionSummary } from "./terminal/types";
import { Kbd, KbdGroup } from "./ui/kbd";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarSeparator,
} from "./ui/sidebar";
import { TooltipProvider } from "./ui/tooltip";
import { WorkspaceSidebarHeaderActions } from "./WorkspaceSidebarHeaderActions";
import { WorkspaceSidebarItem } from "./WorkspaceSidebarItem";
import { WorkspaceSidebarPanelButton } from "./WorkspaceSidebarPanelButton";
import { WorkspaceSidebarResizeHandle } from "./WorkspaceSidebarResizeHandle";

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
  onBulkArchive?: () => void;
  onArchiveWorkspace?: (workspace: Workspace) => void;
  archivingWorkspaceIds?: Set<number>;
  exitingWorkspaceIds?: Set<number>;
  openSettings?: (tab?: string) => void;
  navigateToDashboard?: () => void;
  onOpenCommandPalette?: () => void;
  onOpenBranchSwitcher?: () => void;
  onOpenGitHub?: () => void;
  onOpenLinear?: () => void;
  onOpenArtifacts?: () => void;
  currentPage?: string;
  onAddBefore?: (workspace: Workspace) => void;
  onAddAfter?: (workspace: Workspace) => void;
  onMoveWorkspace?: (workspace: Workspace, targetBranch: string | null) => void;
  onSelectStack?: (workspaceIds: Set<number>) => void;
  onStartAgent?: (workspace: Workspace) => void;
  onStartShell?: (workspace: Workspace) => void;
  onStartHomeAgent?: () => void;
  onStartHomeShell?: () => void;
  onStackHome?: () => void;
  terminalSessions?: TerminalSessionSummary[];
  onFocusTerminalSession?: (id: string) => void;
  onCloseTerminalSession?: (id: string) => void;
  onCloseIdleTerminalSessions?: () => void;
  onCloseAllTerminalSessions?: () => void;
  onCreateAgentTerminal?: () => void;
  onCreateShellTerminal?: () => void;
  onDropChangeFiles?: (request: ChangeFilesMoveRequest) => void;
}

export const WorkspaceSidebar: React.FC<WorkspaceSidebarProps> = ({
  repoPath,
  homeRepoDisplayRef,
  selectedWorkspaceId,
  selectedWorkspaceIds,
  onWorkspaceClick,
  onWorkspaceMultiSelect,
  onBulkArchive,
  onArchiveWorkspace,
  archivingWorkspaceIds,
  exitingWorkspaceIds,
  openSettings,
  onOpenCommandPalette,
  onOpenBranchSwitcher,
  onOpenGitHub,
  onOpenLinear,
  onOpenArtifacts,
  currentPage,
  onAddAfter,
  onMoveWorkspace,
  onSelectStack,
  onStartAgent,
  onStartShell,
  onStartHomeAgent,
  onStartHomeShell,
  onStackHome,
  terminalSessions,
  onFocusTerminalSession,
  onCloseTerminalSession,
  onCloseIdleTerminalSessions,
  onCloseAllTerminalSessions,
  onCreateAgentTerminal,
  onCreateShellTerminal,
  onDropChangeFiles,
}) => {
  const cacheKey = useRepositoryCacheKey(repoPath);
  const workspaceScheduling = usePreviewFeature("workspaceScheduling");
  const linearIntegration = usePreviewFeature("linearIntegration");
  const { data: workspaces = [], isLoading: workspacesPending } = useSWR(
    cacheKey ? ["workspaces", cacheKey] : null,
    () => getWorkspaces(repoPath || ""),
    { keepPreviousData: true },
  );
  const workspacesLoaded = workspacesPending === false && Boolean(repoPath);

  const { data: workspaceStatuses = [] } = useSWR(
    cacheKey && workspacesLoaded ? ["workspace-statuses", cacheKey] : null,
    async () => {
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
    { keepPreviousData: true },
  );

  const { data: remoteInfo } = useGitRemoteInfo(repoPath);
  const { data: queueEnabled } = useMergeQueueEnabled(repoPath);
  const repoFullName = remoteInfo?.full_name;
  // Single Rust-backed cache for all workspace PR statuses — no per-row
  // `gh pr view` polling from the WebView.
  const { data: prStatusesByBranch = {} } = usePrStatusPolling(repoPath);
  const { data: branchQueueStatuses } = useSWR(
    FEATURES.mergeQueue && queueEnabled === true && repoFullName
      ? ["repo-branch-queue-statuses", repoFullName]
      : null,
    async () => {
      const { data } = await supabase.rpc("get_repo_branch_queue_statuses", {
        p_repo_full_name: repoFullName!,
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
    { refreshInterval: pollMs(30_000) },
  );

  const statuses: WorkspaceSidebarStatus[] = (() => {
    const statusById = new Map(
      (workspaceStatuses ?? []).map((status) => [status.current.id, status]),
    );
    return (workspaces ?? []).map((workspace) => {
      const status = statusById.get(workspace.id);
      return status ?? { current: workspace, has_conflicts: false };
    });
  })();
  const workspacesForSelection = statuses.map((s) => s.current);
  const [renameTarget, setRenameTarget] = useState<Workspace | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  const visibleStatuses = (() => {
    if (!workspaceScheduling || showHidden) return statuses;
    return statuses.filter((status) => !isWorkspaceHidden(status.current));
  })();
  const hiddenCount = workspaceScheduling
    ? statuses.filter((status) => isWorkspaceHidden(status.current)).length
    : 0;

  const flattenedNodes = (() => {
    const isMergedBranch = (branchName: string) =>
      (prStatusesByBranch as Record<string, PrInfo | null>)[branchName]
        ?.state === "MERGED";
    const tree = buildWorkspaceTree(visibleStatuses, isMergedBranch);
    return flattenWorkspaceTree(tree);
  })();

  const { handleItemSelect, clearLastSelectedIndex } =
    useWorkspaceSidebarMultiSelect({
      flattenedNodes,
      onSelectStack,
      onWorkspaceMultiSelect,
      onWorkspaceClick,
    });

  const handleContainerClick = (e: React.MouseEvent) => {
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
      clearLastSelectedIndex();
    }
  };

  const handleDoubleClick = (workspace: Workspace, e: React.MouseEvent) => {
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

    const stack = getEntireStack(workspacesForSelection, workspace.branch_name);
    onSelectStack(new Set(stack.map((w) => w.id)));
  };

  const handleDragEnd = (result: DropResult) => {
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
  };

  const repoName = repoPath
    ? repoPath.split("/").filter(Boolean).pop() || "Repository"
    : "Repository";

  // GitHub/Linear/Settings are their own nav destinations — don't keep home/workspace
  // selection highlighted alongside them.
  const workspaceSelectionActive =
    currentPage !== "github" &&
    currentPage !== "linear" &&
    currentPage !== "settings" &&
    currentPage !== "artifacts";
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
      <Sidebar
        collapsible="none"
        className="group/sidebar relative h-screen border-r border-border"
        data-testid="workspace-sidebar"
      >
        <SidebarHeader>
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              data-testid="command-palette-trigger"
              onClick={onOpenCommandPalette}
              className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden px-3 py-1.5 rounded-lg border border-border bg-muted/50 hover:bg-muted text-muted-foreground transition-colors"
            >
              <Search className="w-4 h-4 shrink-0" />
              <span
                className="min-w-0 flex-1 truncate text-left"
                title={repoName}
              >
                {repoName}
              </span>
              <KbdGroup className="shrink-0">
                <Kbd>⌘ + K</Kbd>
              </KbdGroup>
            </button>
            <WorkspaceSidebarHeaderActions
              currentPage={currentPage}
              onOpenArtifacts={onOpenArtifacts}
              openSettings={openSettings}
            />
          </div>
        </SidebarHeader>

        <SidebarContent className="select-none" onClick={handleContainerClick}>
          <SidebarGroup className="py-0">
            <SidebarGroupContent>
              <SidebarMenu>
                <HomeRepoSidebarRow
                  repoPath={repoPath}
                  homeRepoDisplayRef={homeRepoDisplayRef}
                  isHomeSelected={isHomeSelected}
                  selectedWorkspaceIds={selectedWorkspaceIds}
                  onWorkspaceClick={onWorkspaceClick}
                  onWorkspaceMultiSelect={onWorkspaceMultiSelect}
                  onOpenBranchSwitcher={onOpenBranchSwitcher}
                  onDropChangeFiles={onDropChangeFiles}
                  onStartAgent={onStartHomeAgent}
                  onStartShell={onStartHomeShell}
                  onStack={onStackHome}
                />

                {onOpenGitHub && (
                  <WorkspaceSidebarPanelButton
                    page="github"
                    currentPage={currentPage}
                    onClick={onOpenGitHub}
                    icon={Github}
                    label="Github"
                    testId="github-sidebar-item"
                  />
                )}

                {onOpenLinear && linearIntegration && (
                  <WorkspaceSidebarPanelButton
                    page="linear"
                    currentPage={currentPage}
                    onClick={onOpenLinear}
                    icon={ListTodo}
                    label="Linear"
                    testId="linear-sidebar-item"
                  />
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {workspaces.length > 0 && <SidebarSeparator />}

          <SidebarGroup className="py-0">
            <SidebarGroupLabel className="uppercase tracking-widest">
              Workspaces
            </SidebarGroupLabel>
            {workspaceScheduling && (
              <HiddenWorkspacesToggle
                showHidden={showHidden}
                hiddenCount={hiddenCount}
                onToggle={() => setShowHidden((value) => !value)}
              />
            )}
            <SidebarGroupContent>
              <DragDropContext onDragEnd={handleDragEnd}>
                <Droppable droppableId="sidebar-root" isCombineEnabled>
                  {(droppableProvided) => (
                    <SidebarMenu
                      ref={droppableProvided.innerRef}
                      {...droppableProvided.droppableProps}
                    >
                      {workspacesPending &&
                        flattenedNodes.length === 0 &&
                        Array.from({ length: 6 }, (_, index) => (
                          <SidebarMenuItem key={`workspace-skeleton-${index}`}>
                            <SidebarMenuSkeleton />
                          </SidebarMenuItem>
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
                          onWorkspaceMultiSelect={handleItemSelect}
                          onAddAfter={onAddAfter}
                          onStartAgent={onStartAgent}
                          onStartShell={onStartShell}
                          onArchiveWorkspace={onArchiveWorkspace}
                          archiving={archivingWorkspaceIds?.has(
                            node.status.current.id,
                          )}
                          exiting={exitingWorkspaceIds?.has(
                            node.status.current.id,
                          )}
                          onRenameWorkspace={setRenameTarget}
                          onDoubleClick={handleDoubleClick}
                          queueStatus={branchQueueStatuses?.get(
                            node.status.current.branch_name,
                          )}
                          prInfo={
                            (
                              prStatusesByBranch as Record<
                                string,
                                PrInfo | null
                              >
                            )[node.status.current.branch_name] ?? null
                          }
                          hasRemote={!!remoteInfo}
                          onDropChangeFiles={onDropChangeFiles}
                        />
                      ))}
                      {droppableProvided.placeholder}
                      {selectedWorkspaceIds &&
                        selectedWorkspaceIds.size > 0 &&
                        !archivingWorkspaceIds?.size &&
                        !exitingWorkspaceIds?.size && (
                          <SidebarMenuItem>
                            <SidebarMenuButton
                              type="button"
                              onClick={onBulkArchive}
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            >
                              <Archive />
                              <span>
                                Archive {selectedWorkspaceIds.size} workspace
                                {selectedWorkspaceIds.size > 1 ? "s" : ""}
                              </span>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        )}
                    </SidebarMenu>
                  )}
                </Droppable>
              </DragDropContext>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="p-0">
          <TerminalSessionsSidebar
            sessions={terminalSessions ?? []}
            onFocus={onFocusTerminalSession}
            onClose={onCloseTerminalSession}
            onCloseIdle={onCloseIdleTerminalSessions}
            onCloseAll={onCloseAllTerminalSessions}
            onCreateAgent={onCreateAgentTerminal}
            onCreateShell={onCreateShellTerminal}
          />
        </SidebarFooter>
        <WorkspaceSidebarResizeHandle />
      </Sidebar>
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
};
