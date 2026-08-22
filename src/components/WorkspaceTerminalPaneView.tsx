import React from "react";
import {
  ChevronDown,
  ChevronUp,
  GitBranch,
  Home,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { type ConsolidatedTerminalHandle } from "./ConsolidatedTerminal";
import { Button } from "./ui/button";
import { Kbd, KbdGroup } from "./ui/kbd";
import { cn } from "../lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import { AgentTerminalPanel } from "./terminal/AgentTerminalPanel";
import { ResizeDivider } from "./terminal/ResizeDivider";
import { ShellTerminalPanel } from "./terminal/ShellTerminalPanel";
import { type ClaudeSessionData } from "./terminal/types";

interface ShellTerminalData {
  id: string;
  workingDirectory: string;
}

interface WorkspaceGroup {
  workspaceKey: string;
  workspaceName: string;
  isMainRepo: boolean;
  terminals: Array<
    | { type: "shell"; data: ShellTerminalData }
    | { type: "claude"; data: ClaudeSessionData }
  >;
}

interface WorkspaceTerminalPaneViewProps {
  paneRef: React.RefObject<HTMLDivElement | null>;
  className?: string;
  collapsed: boolean;
  maximized: boolean;
  height: number;
  isResizingHeight: boolean;
  handleHeightResizeMouseDown: (e: React.MouseEvent) => void;
  totalTerminals: number;
  setCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  setMaximized: React.Dispatch<React.SetStateAction<boolean>>;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  workspaceGroups: WorkspaceGroup[];
  containerWidth: number;
  onNavigateToWorkspace?: (workspaceKey: string, isMainRepo: boolean) => void;
  currentBranch?: string | null;
  activePtySessionId: string | null;
  setActivePtySessionId: React.Dispatch<React.SetStateAction<string | null>>;
  handleCloseShell: (terminalId: string) => void | Promise<void>;
  onSessionError?: (message: string) => void;
  terminalRefs: React.RefObject<Map<string, ConsolidatedTerminalHandle | null>>;
  terminalWidths: Map<string, number | null>;
  handleTerminalResize: (
    leftId: string,
    rightId: string,
    deltaX: number,
  ) => void;
  handleCloseClaudeSession: (sessionId: number) => void | Promise<void>;
  onTerminalDoubleClick: (terminalId: string) => void;
  onTerminalOutput?: (
    terminalId: string,
    output: string,
    fromProcess?: boolean,
  ) => void;
  onTerminalInput?: (terminalId: string) => void;
  onTerminalIdle?: (terminalId: string) => void;
}

export const WorkspaceTerminalPaneView: React.FC<
  WorkspaceTerminalPaneViewProps
> = ({
  paneRef,
  className,
  collapsed,
  maximized,
  height,
  isResizingHeight,
  handleHeightResizeMouseDown,
  totalTerminals,
  setCollapsed,
  setMaximized,
  scrollContainerRef,
  workspaceGroups,
  containerWidth,
  onNavigateToWorkspace,
  currentBranch,
  activePtySessionId,
  setActivePtySessionId,
  handleCloseShell,
  onSessionError,
  terminalRefs,
  terminalWidths,
  handleTerminalResize,
  handleCloseClaudeSession,
  onTerminalDoubleClick,
  onTerminalOutput,
  onTerminalInput,
  onTerminalIdle,
}) => (
  <div
    ref={paneRef as React.Ref<HTMLDivElement>}
    className={className}
    style={{ display: "contents" }}
  >
    {!collapsed && !maximized && (
      <div
        className="relative flex-shrink-0 h-1 group"
        onMouseDown={handleHeightResizeMouseDown}
      >
        <div
          className={cn(
            "absolute inset-x-0 top-0 h-1 bg-border transition-colors",
            "group-hover:bg-primary/50",
            isResizingHeight && "bg-primary",
          )}
        />
        <div className="absolute inset-x-0 -top-1 h-3 cursor-ns-resize" />
      </div>
    )}

    <div
      data-testid="workspace-terminal-pane"
      className={cn(
        "relative flex flex-col flex-shrink-0",
        collapsed
          ? "self-end m-1.5 overflow-visible"
          : "border-t bg-background overflow-hidden",
      )}
      style={
        collapsed
          ? undefined
          : {
              height: maximized ? "100%" : `${height}%`,
              maxHeight: maximized ? "100%" : "60%",
            }
      }
    >
      <TooltipProvider>
        <div
          data-testid="terminal-pane-controls"
          className={cn(
            "z-20 flex items-center gap-px rounded-md border border-border/80 bg-background/90 p-0.5 shadow-sm backdrop-blur-sm",
            collapsed ? "relative" : "absolute top-1.5 right-1.5",
          )}
        >
          {collapsed && (
            <PaneControlButton
              ariaLabel="Expand terminal"
              tooltip="Expand"
              shortcut="⌘ + J"
              onClick={() => setCollapsed(false)}
            >
              <ChevronUp className="w-3 h-3" />
            </PaneControlButton>
          )}
          {!collapsed && maximized && (
            <PaneControlButton
              ariaLabel="Restore terminal"
              tooltip="Restore"
              shortcut="⌘ + ^ + J"
              onClick={() => setMaximized(false)}
            >
              <Minimize2 className="w-3 h-3" />
            </PaneControlButton>
          )}
          {!collapsed && !maximized && totalTerminals > 0 && (
            <PaneControlButton
              ariaLabel="Maximize terminal"
              tooltip="Maximize"
              shortcut="⌘ + Ctrl+ J"
              onClick={() => setMaximized(true)}
            >
              <Maximize2 className="w-3 h-3" />
            </PaneControlButton>
          )}
          {!collapsed && (
            <PaneControlButton
              ariaLabel="Collapse terminal"
              tooltip="Collapse"
              shortcut="⌘ + J"
              onClick={() => {
                setCollapsed(true);
                setMaximized(false);
              }}
            >
              <ChevronDown className="w-3 h-3" />
            </PaneControlButton>
          )}
        </div>
      </TooltipProvider>

      {!collapsed && (
        <div
          ref={scrollContainerRef as React.Ref<HTMLDivElement>}
          data-testid="terminal-scroll-container"
          className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden flex"
          style={{ backgroundColor: "#1e1e1e" }}
        >
          {workspaceGroups.map((group, groupIndex) => {
            const minTerminalPx = containerWidth * 0.4 || 300;
            const groupMinWidth = group.terminals.length * minTerminalPx;
            const groupMaxWidth =
              workspaceGroups.length > 1 && group.terminals.length === 1
                ? containerWidth * 0.5
                : undefined;
            return (
              <div
                key={group.workspaceKey}
                data-workspace-group={group.workspaceKey}
                className={cn(
                  "flex flex-col min-h-0 flex-shrink-0",
                  groupIndex > 0 && "border-l-2 border-border",
                )}
                style={{
                  minWidth: groupMinWidth,
                  maxWidth: groupMaxWidth,
                  flex: "1 0 auto",
                }}
              >
                <div
                  className="h-8 flex items-center gap-2 px-2 pr-14 border-b border-border bg-gray-700/100 flex-shrink-0 sticky left-0 z-10 overflow-hidden cursor-pointer hover:bg-muted/40 transition-colors"
                  style={{
                    width: containerWidth > 0 ? containerWidth : undefined,
                  }}
                  onClick={() =>
                    onNavigateToWorkspace?.(
                      group.workspaceKey,
                      group.isMainRepo,
                    )
                  }
                >
                  {group.isMainRepo ? (
                    <Home className="w-4 h-4 text-gray-200 flex-shrink-0" />
                  ) : (
                    <GitBranch className="w-4 h-4 text-gray-200 flex-shrink-0" />
                  )}
                  <span
                    className="text-sm text-gray-200 truncate font-mono"
                    title={
                      group.isMainRepo
                        ? currentBranch || "main"
                        : group.workspaceName
                    }
                  >
                    {group.isMainRepo
                      ? currentBranch || "main"
                      : group.workspaceName}
                  </span>
                </div>
                <div className="flex min-h-0 flex-1">
                  {group.terminals.map((terminal, index) => {
                    const isLastInGroup = index === group.terminals.length - 1;
                    const nextTerminal = group.terminals[index + 1];

                    if (terminal.type === "shell") {
                      const terminalId = terminal.data.id;
                      return (
                        <React.Fragment key={terminalId}>
                          <ShellTerminalPanel
                            terminalData={terminal.data}
                            collapsed={collapsed}
                            isActive={activePtySessionId === terminalId}
                            onFocus={() => setActivePtySessionId(terminalId)}
                            onDoubleClick={() =>
                              onTerminalDoubleClick(terminalId)
                            }
                            onClose={() => handleCloseShell(terminalId)}
                            canClose={true}
                            onSessionError={onSessionError}
                            onTerminalOutput={(output, fromProcess) =>
                              onTerminalOutput?.(
                                terminalId,
                                output,
                                fromProcess,
                              )
                            }
                            onTerminalInput={() =>
                              onTerminalInput?.(terminalId)
                            }
                            onTerminalIdle={() => onTerminalIdle?.(terminalId)}
                            terminalRefs={
                              terminalRefs as React.MutableRefObject<
                                Map<string, ConsolidatedTerminalHandle | null>
                              >
                            }
                            width={terminalWidths.get(terminalId)}
                          />
                          {!isLastInGroup && nextTerminal && (
                            <ResizeDivider
                              onResize={(deltaX) => {
                                const nextId =
                                  nextTerminal.type === "shell"
                                    ? nextTerminal.data.id
                                    : `claude-${nextTerminal.data.sessionId}`;
                                handleTerminalResize(
                                  terminalId,
                                  nextId,
                                  deltaX,
                                );
                              }}
                            />
                          )}
                        </React.Fragment>
                      );
                    }

                    const terminalId = `claude-${terminal.data.sessionId}`;
                    const ptyId = terminal.data.ptySessionId;
                    return (
                      <React.Fragment key={terminalId}>
                        <AgentTerminalPanel
                          sessionData={terminal.data}
                          collapsed={collapsed}
                          isActive={activePtySessionId === ptyId}
                          onFocus={() => setActivePtySessionId(ptyId)}
                          onDoubleClick={() =>
                            onTerminalDoubleClick(terminalId)
                          }
                          onClose={() =>
                            handleCloseClaudeSession(terminal.data.sessionId)
                          }
                          onSessionError={onSessionError}
                          onTerminalOutput={(output, fromProcess) =>
                            onTerminalOutput?.(terminalId, output, fromProcess)
                          }
                          onTerminalInput={() => onTerminalInput?.(terminalId)}
                          onTerminalIdle={() => onTerminalIdle?.(terminalId)}
                          terminalRefs={
                            terminalRefs as React.MutableRefObject<
                              Map<string, ConsolidatedTerminalHandle | null>
                            >
                          }
                          width={terminalWidths.get(terminalId)}
                        />
                        {!isLastInGroup && nextTerminal && (
                          <ResizeDivider
                            onResize={(deltaX) => {
                              const nextId =
                                nextTerminal.type === "shell"
                                  ? nextTerminal.data.id
                                  : `claude-${nextTerminal.data.sessionId}`;
                              handleTerminalResize(terminalId, nextId, deltaX);
                            }}
                          />
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  </div>
);

function PaneControlButton({
  ariaLabel,
  tooltip,
  shortcut,
  onClick,
  children,
}: {
  ariaLabel: string;
  tooltip: string;
  shortcut: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          onClick={onClick}
          variant="ghost"
          className="h-5 w-5 rounded-sm p-0"
          aria-label={ariaLabel}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-1.5">
        {tooltip}
        <KbdGroup>
          <Kbd>{shortcut}</Kbd>
        </KbdGroup>
      </TooltipContent>
    </Tooltip>
  );
}
