import { Draggable } from "@hello-pangea/dnd";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  AlertTriangle,
  CalendarClock,
  Copy,
  FolderOpen,
  GitBranch,
  Layers2,
  Link,
  Pencil,
  Terminal,
  Trash2,
} from "lucide-react";
import { ClaudeIcon } from "./icons/AgentIcons";
import { useState } from "react";
import { useEditorAppsStore } from "../stores/editorAppsStore";
import { type QueueEntryStatus, type Workspace } from "../lib/api";
import { clearWorkspaceSchedule } from "../lib/clear-workspace-schedule";
import type { PrInfo } from "../lib/api-types";
import { cn, getFullWorkspacePath } from "../lib/utils";
import type { FlattenedWorkspaceNode } from "../lib/workspace-tree";
import {
  getWorkspaceTitle as getWorkspaceTitleFromUtils,
  isWorkspaceHidden,
} from "../lib/workspace-utils";
import {
  getChangeFilesDragData,
  isChangeFilesDrag,
  type ChangeFilesMoveRequest,
} from "../lib/change-file-drag";
import { Button } from "./ui/button";
import { SidebarMenuItem } from "./ui/sidebar";
import { useToast } from "./ui/toast";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { useWorkspaceRowPointerHandlers } from "../hooks/useWorkspaceSidebarMultiSelect";

export const PathContextMenuItems: React.FC<{
  relativePath: string;
  fullPath: string;
  additionalItems?: React.ReactNode;
}> = ({ relativePath, fullPath, additionalItems }) => {
  const editorApps = useEditorAppsStore();

  return (
    <>
      <ContextMenuItem
        onClick={() => navigator.clipboard.writeText(relativePath)}
      >
        <Copy className="w-4 h-4 mr-2" />
        Copy relative path
      </ContextMenuItem>
      <ContextMenuItem onClick={() => navigator.clipboard.writeText(fullPath)}>
        <Copy className="w-4 h-4 mr-2" />
        Copy full path
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <FolderOpen className="w-4 h-4 mr-2" />
          Open in...
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem onClick={() => revealItemInDir(fullPath)}>
            <FolderOpen className="w-4 h-4 mr-2" />
            Open in Finder
          </ContextMenuItem>

          {editorApps.cursor && (
            <ContextMenuItem
              onClick={async () => {
                try {
                  await openUrl(`cursor://file/${fullPath}`);
                } catch (err) {
                  console.error("Failed to open in Cursor:", err);
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
                  await openUrl(`vscode://file/${fullPath}`);
                } catch (err) {
                  console.error("Failed to open in VSCode:", err);
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
                  await openUrl(`zed://file/${fullPath}`);
                } catch (err) {
                  console.error("Failed to open in Zed:", err);
                }
              }}
            >
              Open in Zed
            </ContextMenuItem>
          )}
        </ContextMenuSubContent>
      </ContextMenuSub>
      {additionalItems}
    </>
  );
};

interface WorkspaceSidebarItemProps {
  node: FlattenedWorkspaceNode;
  index: number;
  repoPath?: string;
  selectedWorkspaceId?: number | null;
  selectedWorkspaceIds?: Set<number>;
  onWorkspaceClick?: (workspace: Workspace) => void;
  onWorkspaceMultiSelect?: (
    workspace: Workspace,
    event: React.MouseEvent | React.PointerEvent,
    index: number,
  ) => void;
  onAddAfter?: (workspace: Workspace) => void;
  onStartAgent?: (workspace: Workspace) => void;
  onStartShell?: (workspace: Workspace) => void;
  onDeleteWorkspace?: (workspace: Workspace) => void;
  onRenameWorkspace: (workspace: Workspace) => void;
  onDoubleClick?: (workspace: Workspace, event: React.MouseEvent) => void;
  queueStatus?: QueueEntryStatus;
  /** Cached PR info from the Rust background poller (null = no PR / not yet known). */
  prInfo?: PrInfo | null;
  /** Whether the repo has a GitHub remote (gates PR icon coloring). */
  hasRemote?: boolean;
  onDropChangeFiles?: (request: ChangeFilesMoveRequest) => void;
}

function prIconStyle(prInfo: PrInfo): { color: string; label: string } {
  const state = prInfo.state.toUpperCase();
  if (prInfo.is_draft && state === "OPEN") {
    return { color: "text-muted-foreground", label: "Draft PR" };
  }
  if (state === "OPEN") {
    return {
      color: "text-green-600 dark:text-green-400",
      label: "Open PR",
    };
  }
  if (state === "MERGED") {
    return {
      color: "text-purple-600 dark:text-purple-400",
      label: "PR merged",
    };
  }
  return { color: "text-red-600 dark:text-red-400", label: "PR closed" };
}

function queueStatusDot(status: QueueEntryStatus): {
  color: string;
  label: string;
} {
  switch (status) {
    case "queued":
      return { color: "bg-yellow-400", label: "In merge queue" };
    case "testing":
      return {
        color: "bg-blue-400 animate-pulse",
        label: "CI running in merge queue",
      };
    case "merging":
      return {
        color: "bg-green-400 animate-pulse",
        label: "Passed CI, merging now",
      };
    case "merged":
      return { color: "bg-green-600", label: "Merged via queue" };
    case "failed":
      return { color: "bg-red-500", label: "Failed in merge queue" };
    default:
      return { color: "bg-muted-foreground", label: status };
  }
}

export const WorkspaceSidebarItem: React.FC<WorkspaceSidebarItemProps> = ({
  node,
  index,
  repoPath,
  selectedWorkspaceId,
  selectedWorkspaceIds,
  onWorkspaceClick,
  onWorkspaceMultiSelect,
  onAddAfter,
  onStartAgent,
  onStartShell,
  onDeleteWorkspace,
  onRenameWorkspace,
  onDoubleClick,
  queueStatus,
  prInfo = null,
  hasRemote = false,
  onDropChangeFiles,
}) => {
  const workspace = node.status.current;
  const { addToast } = useToast();
  const isSelected =
    selectedWorkspaceIds?.has(workspace.id) ||
    selectedWorkspaceId === workspace.id;
  const indentStyle = {
    paddingLeft: `${16 + (node.depth - 1) * 6}px`,
  };
  const isConflicted = node.status.has_conflicts;
  const isHidden = isWorkspaceHidden(workspace);
  const workspaceTitle = getWorkspaceTitleFromUtils(workspace);
  const prStatus = hasRemote && prInfo ? prIconStyle(prInfo) : null;
  const [isChangeDropTarget, setIsChangeDropTarget] = useState(false);
  const { onPointerDown, onClick } = useWorkspaceRowPointerHandlers({
    onSelect: (event) => {
      if (onWorkspaceMultiSelect) {
        onWorkspaceMultiSelect(workspace, event, index);
        return;
      }
      onWorkspaceClick?.(workspace);
    },
  });

  return (
    <SidebarMenuItem>
      <Draggable draggableId={String(workspace.id)} index={index}>
        {(dragProvided, dragSnapshot) => (
          <div
            ref={dragProvided.innerRef}
            {...dragProvided.draggableProps}
            {...dragProvided.dragHandleProps}
          >
            <ContextMenu>
              <Tooltip>
                <ContextMenuTrigger asChild>
                  <TooltipTrigger asChild>
                    <div
                      data-testid={`workspace-sidebar-item-${workspace.branch_name}`}
                      data-sidebar-index={index}
                      style={indentStyle}
                      className={cn(
                        "group/workspace relative flex items-center  tracking-wide pr-4 rounded-sm transition-colors cursor-pointer p-0.5",
                        {
                          "bg-primary/20": isSelected,
                          "hover:bg-muted/50": !isSelected,
                          "bg-primary/10":
                            dragSnapshot.combineTargetFor || isChangeDropTarget,
                          "opacity-50": dragSnapshot.isDragging,
                          "opacity-60": isHidden && !dragSnapshot.isDragging,
                          "text-destructive": isConflicted,
                        },
                      )}
                      onPointerDown={onPointerDown}
                      onClick={onClick}
                      onDoubleClick={(e) => onDoubleClick?.(workspace, e)}
                      onDragOver={(e) => {
                        if (
                          !onDropChangeFiles ||
                          !isChangeFilesDrag(e.dataTransfer)
                        )
                          return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        setIsChangeDropTarget(true);
                      }}
                      onDragLeave={() => setIsChangeDropTarget(false)}
                      onDrop={(e) => {
                        setIsChangeDropTarget(false);
                        if (!onDropChangeFiles) return;
                        const payload = getChangeFilesDragData(e.dataTransfer);
                        if (!payload) return;
                        e.preventDefault();
                        e.stopPropagation();
                        if (payload.sourceBranch === workspace.branch_name)
                          return;
                        onDropChangeFiles({
                          files: payload.files,
                          sourceBranch: payload.sourceBranch,
                          destinationBranch: workspace.branch_name,
                          destinationLabel: workspaceTitle,
                        });
                      }}
                    >
                      <GitBranch
                        data-testid={`workspace-pr-icon-${workspace.id}`}
                        aria-label={prStatus ? prStatus.label : undefined}
                        className={`w-3 h-3 mr-1 shrink-0 -scale-y-100 ${
                          prStatus
                            ? prStatus.color
                            : isSelected
                              ? "text-primary"
                              : "text-muted-foreground"
                        }`}
                      />
                      <span
                        className={`flex-1 min-w-0 truncate font-mono ${
                          isSelected
                            ? "text-primary font-medium"
                            : "text-muted-foreground"
                        }`}
                      >
                        {workspaceTitle}
                      </span>
                      {isHidden && (
                        <CalendarClock
                          className="w-3 h-3 text-muted-foreground shrink-0 mr-1"
                          aria-label="Scheduled hidden"
                        />
                      )}
                      {isConflicted && (
                        <AlertTriangle
                          data-testid={`workspace-conflict-indicator-${workspace.id}`}
                          className="w-3.5 h-3.5 text-destructive shrink-0 mr-1"
                          aria-label="Conflicted workspace"
                        />
                      )}
                      {queueStatus && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 mr-1 ${queueStatusDot(queueStatus).color}`}
                              aria-label={queueStatusDot(queueStatus).label}
                            />
                          </TooltipTrigger>
                          <TooltipContent side="right">
                            {queueStatusDot(queueStatus).label}
                          </TooltipContent>
                        </Tooltip>
                      )}
                      <div className="flex items-center gap-1 shrink-0 mr-1 opacity-0 group-hover/workspace:opacity-100 group-focus-within/workspace:opacity-100 transition-opacity">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              className="text-foreground"
                              aria-label="Start agent"
                              onClick={(e) => {
                                e.stopPropagation();
                                onStartAgent?.(workspace);
                              }}
                            >
                              <ClaudeIcon className="w-4 h-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            Start agent
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              className="text-foreground"
                              aria-label="Open shell"
                              onClick={(e) => {
                                e.stopPropagation();
                                onStartShell?.(workspace);
                              }}
                            >
                              <Terminal className="w-4 h-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            Open shell
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              className="text-foreground"
                              aria-label="Stack a workspace"
                              onClick={(e) => {
                                e.stopPropagation();
                                onAddAfter?.(workspace);
                              }}
                            >
                              <Layers2 className="w-4 h-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            Stack workspace
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                  </TooltipTrigger>
                </ContextMenuTrigger>
                {!dragSnapshot.isDragging && (
                  <TooltipContent side="right" className="font-mono">
                    <div className="flex items-center gap-1.5">
                      <GitBranch className="w-3 h-3" />
                      <span>{workspaceTitle}</span>
                    </div>
                    {isConflicted && (
                      <div className="font-sans mt-1 text-destructive">
                        Conflicts detected
                      </div>
                    )}
                    {prStatus && (
                      <div className={`font-sans mt-1 ${prStatus.color}`}>
                        {prStatus.label}
                      </div>
                    )}
                  </TooltipContent>
                )}
              </Tooltip>
              <ContextMenuContent>
                <ContextMenuItem
                  onClick={() => navigator.clipboard.writeText(workspaceTitle)}
                >
                  <GitBranch className="w-4 h-4 mr-2" />
                  Copy branch name
                </ContextMenuItem>
                {prInfo && (
                  <ContextMenuItem
                    onClick={() => navigator.clipboard.writeText(prInfo.url)}
                  >
                    <Link className="w-4 h-4 mr-2" />
                    Copy link to GitHub PR
                  </ContextMenuItem>
                )}
                <ContextMenuItem onClick={() => onRenameWorkspace(workspace)}>
                  <Pencil className="w-4 h-4 mr-2" />
                  Rename Workspace
                </ContextMenuItem>
                {repoPath && isWorkspaceHidden(workspace) && (
                  <ContextMenuItem
                    data-testid="remove-schedule-menu-item"
                    onClick={() => {
                      void clearWorkspaceSchedule(repoPath, [
                        workspace.id,
                      ]).then(() => {
                        addToast({
                          title: "Workspace unscheduled",
                          description: "Shown in the sidebar again.",
                          type: "success",
                        });
                      });
                    }}
                  >
                    <CalendarClock className="w-4 h-4 mr-2" />
                    Remove schedule
                  </ContextMenuItem>
                )}
                <ContextMenuSeparator />
                <PathContextMenuItems
                  relativePath={
                    workspace.workspace_path.startsWith("/")
                      ? repoPath &&
                        workspace.workspace_path.startsWith(repoPath)
                        ? workspace.workspace_path.slice(repoPath.length + 1)
                        : workspace.workspace_path
                      : `.treq/workspaces/${workspace.workspace_path}`
                  }
                  fullPath={getFullWorkspacePath(workspace)}
                  additionalItems={
                    <>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => onDeleteWorkspace?.(workspace)}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete Workspace
                      </ContextMenuItem>
                    </>
                  }
                />
              </ContextMenuContent>
            </ContextMenu>
            {dragSnapshot.combineTargetFor && (
              <div className="relative h-0">
                <div className="absolute left-0 right-0 top-0 h-[2px] bg-primary rounded-full" />
              </div>
            )}
          </div>
        )}
      </Draggable>
    </SidebarMenuItem>
  );
};
