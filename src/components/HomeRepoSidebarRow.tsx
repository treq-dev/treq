import { Bot, GitBranch, Home, Layers2, Terminal } from "lucide-react";
import type { MouseEvent } from "react";
import type { Workspace } from "../lib/api";
import {
  getChangeFilesDragData,
  HOME_MOVE_ENDPOINT,
  isChangeFilesDrag,
  type ChangeFilesMoveRequest,
} from "../lib/change-file-drag";
import { useRemoteCapabilities } from "../lib/active-repository-context";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { SidebarMenuButton, SidebarMenuItem } from "./ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { PathContextMenuItems } from "./WorkspacePathContextMenu";

interface HomeRepoSidebarRowProps {
  repoPath?: string;
  homeRepoDisplayRef?: string | null;
  isHomeSelected: boolean;
  selectedWorkspaceIds?: Set<number>;
  onWorkspaceClick?: (workspace: Workspace) => void;
  onWorkspaceMultiSelect?: (
    workspace: Workspace | null,
    event: MouseEvent,
  ) => void;
  onOpenBranchSwitcher?: () => void;
  onDropChangeFiles?: (request: ChangeFilesMoveRequest) => void;
  onStartAgent?: () => void;
  onStartShell?: () => void;
  onStack?: () => void;
}

export function HomeRepoSidebarRow({
  repoPath,
  homeRepoDisplayRef,
  isHomeSelected,
  selectedWorkspaceIds,
  onWorkspaceClick,
  onWorkspaceMultiSelect,
  onOpenBranchSwitcher,
  onDropChangeFiles,
  onStartAgent,
  onStartShell,
  onStack,
}: HomeRepoSidebarRowProps) {
  const caps = useRemoteCapabilities();
  return (
    <SidebarMenuItem>
      <ContextMenu>
        <Tooltip>
          <ContextMenuTrigger asChild>
            <TooltipTrigger asChild>
              <SidebarMenuButton
                asChild
                isActive={isHomeSelected}
                className={cn("h-auto py-1", isHomeSelected && "bg-primary/20")}
              >
                <div
                  data-testid="home-repo-row"
                  onClick={(e) => {
                    if (
                      selectedWorkspaceIds &&
                      selectedWorkspaceIds.size > 0 &&
                      onWorkspaceMultiSelect
                    ) {
                      onWorkspaceMultiSelect(null, e);
                      return;
                    }
                    onWorkspaceClick?.(undefined as unknown as Workspace);
                  }}
                  onDragOver={(e) => {
                    if (
                      !onDropChangeFiles ||
                      !isChangeFilesDrag(e.dataTransfer)
                    )
                      return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(e) => {
                    if (!onDropChangeFiles) return;
                    const payload = getChangeFilesDragData(e.dataTransfer);
                    if (!payload) return;
                    e.preventDefault();
                    e.stopPropagation();
                    if (payload.sourceBranch === HOME_MOVE_ENDPOINT) return;
                    onDropChangeFiles({
                      files: payload.files,
                      sourceBranch: payload.sourceBranch,
                      destinationBranch: HOME_MOVE_ENDPOINT,
                      destinationLabel: homeRepoDisplayRef || "home",
                    });
                  }}
                >
                  <Home
                    className={`w-3 h-3 mr-1 shrink-0 ${
                      isHomeSelected ? "text-primary" : "text-muted-foreground"
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
                  <div className="flex items-center gap-1 shrink-0 mr-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          className="text-foreground"
                          aria-label="Start agent"
                          disabled={!caps.agentPty.supported}
                          title={caps.agentPty.reason}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!caps.agentPty.supported) return;
                            onStartAgent?.();
                          }}
                        >
                          <Bot className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">Start agent</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          className="text-foreground"
                          aria-label="Open shell"
                          disabled={!caps.shell.supported}
                          title={caps.shell.reason}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!caps.shell.supported) return;
                            onStartShell?.();
                          }}
                        >
                          <Terminal className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">Open shell</TooltipContent>
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
                            onStack?.();
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
              </SidebarMenuButton>
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
          <PathContextMenuItems relativePath="." fullPath={repoPath || ""} />
        </ContextMenuContent>
      </ContextMenu>
    </SidebarMenuItem>
  );
}
