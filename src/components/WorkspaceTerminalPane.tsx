import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { type ConsolidatedTerminalHandle } from "./ConsolidatedTerminal";
import { ptyClose } from "../lib/api";
import { type ClaudeSessionData } from "./terminal/types";
import { WorkspaceTerminalPaneView } from "./WorkspaceTerminalPaneView";
import { buildWorkspaceGroups } from "./workspace-terminal-pane/buildWorkspaceGroups";
import { useScrollContainerWidth } from "./workspace-terminal-pane/useScrollContainerWidth";
import { useScrollTerminalIntoView } from "./workspace-terminal-pane/useScrollTerminalIntoView";
import { useTerminalPaneHeightResize } from "./workspace-terminal-pane/useTerminalPaneHeightResize";
import { useTerminalPaneKeyboardShortcuts } from "./workspace-terminal-pane/useTerminalPaneKeyboardShortcuts";
import { useTerminalSessionActions } from "./workspace-terminal-pane/useTerminalSessionActions";
import { useTerminalSessionSummaries } from "./workspace-terminal-pane/useTerminalSessionSummaries";
import {
  type ShellTerminalData,
  type WorkspaceTerminalPaneHandle,
  type WorkspaceTerminalPaneProps,
} from "./workspace-terminal-pane/types";

export type { WorkspaceTerminalPaneHandle };

const WorkspaceTerminalPaneInner = ({
  workingDirectory,
  onSessionError,
  currentBranch,
  claudeSessions = [],
  activeClaudeSessionId = null,
  onActiveSessionChange,
  onCreateNewSession,
  onCloseSession,
  onNavigateToWorkspace,
  workspaceBranchByPath,
  onTerminalsChange,
  className,
  ref,
}: WorkspaceTerminalPaneProps) => {
  // Shared pane state
  const [collapsed, setCollapsed] = useState(true);
  const [maximized, setMaximized] = useState(false);
  const { height, isResizingHeight, handleHeightResizeMouseDown } =
    useTerminalPaneHeightResize(maximized);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const { scrollToTerminal, handleTerminalDoubleClick } =
    useScrollTerminalIntoView(scrollContainerRef);
  const scrollToTerminalRef = useRef(scrollToTerminal);
  scrollToTerminalRef.current = scrollToTerminal;

  // Track which terminal is focused (last-clicked)
  const [activePtySessionId, setActivePtySessionId] = useState<string | null>(
    null,
  );

  // Clear active terminal when clicking outside the pane
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (
        activePtySessionId &&
        paneRef.current &&
        !paneRef.current.contains(e.target as Node)
      ) {
        setActivePtySessionId(null);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [activePtySessionId]);

  // Track scroll container width for computing 40% min terminal width
  const containerWidth = useScrollContainerWidth(scrollContainerRef, collapsed);

  // Shell terminals - start empty (agent sessions are opened by default instead)
  const [shellTerminals, setShellTerminals] = useState<ShellTerminalData[]>([]);

  // Track mounted Claude sessions to keep them alive
  const [mountedClaudeSessions, setMountedClaudeSessions] = useState<
    Set<number>
  >(new Set());

  // Track order of all terminals (shell and claude) by their IDs
  const [terminalOrder, setTerminalOrder] = useState<string[]>([]);

  // Track terminal widths by ID (null means flex-1, number is fixed pixel width)
  const [terminalWidths, setTerminalWidths] = useState<
    Map<string, number | null>
  >(new Map());

  // Shared refs for all terminals
  const terminalRefs = useRef<Map<string, ConsolidatedTerminalHandle | null>>(
    new Map(),
  );

  // Auto-mount active session when it changes (after creation or selection)
  useEffect(() => {
    if (activeClaudeSessionId === null) return;

    const claudeTerminalId = `claude-${activeClaudeSessionId}`;

    setMountedClaudeSessions((prev) => {
      if (prev.has(activeClaudeSessionId)) return prev;
      const next = new Set(prev);
      next.add(activeClaudeSessionId);
      return next;
    });

    setTerminalOrder((prev) => {
      if (prev.includes(claudeTerminalId)) return prev;
      return [...prev, claudeTerminalId];
    });

    setCollapsed(false);

    // Scroll to the new terminal after it's rendered
    scrollToTerminalRef.current(claudeTerminalId);
  }, [activeClaudeSessionId]);

  // Derive the working directory for new terminals based on the active terminal's workspace.
  // Falls back to the sidebar-selected workspace (workingDirectory prop).
  const activeWorkspaceDir = (() => {
    if (!activePtySessionId) return null;

    // Check claude sessions
    const activeClaude = claudeSessions.find(
      (s) => s.ptySessionId === activePtySessionId,
    );
    if (activeClaude) {
      return activeClaude.workspacePath || activeClaude.repoPath;
    }

    // Check shell terminals
    const activeShell = shellTerminals.find((s) => s.id === activePtySessionId);
    if (activeShell) {
      return activeShell.workingDirectory;
    }

    return null;
  })();

  // Add new shell terminal in the active terminal's workspace, or sidebar-selected workspace
  const handleAddShell = (dirOverride?: string) => {
    const dir = dirOverride || activeWorkspaceDir || workingDirectory;
    const newId = `shell-${dir.replace(/[^a-zA-Z0-9]/g, "-")}-${Date.now()}`;
    setShellTerminals((prev) => [
      ...prev,
      { id: newId, workingDirectory: dir },
    ]);
    // Add to terminal order (rightmost position)
    setTerminalOrder((prev) => [...prev, newId]);
    if (collapsed) {
      setCollapsed(false);
    }
    scrollToTerminal(newId);
  };

  // Create Agent session in the active terminal's workspace, or sidebar-selected workspace
  const handleCreateAgentSession = (agent?: "claude" | "codex" | "cursor") => {
    onCreateNewSession?.(activeWorkspaceDir, agent);
  };

  // Close shell terminal
  const handleCloseShell = (terminalId: string) => {
    console.info(
      "[WorkspaceTerminalPane] shell close requested",
      JSON.stringify({
        terminalId,
        activePtySessionId,
      }),
    );
    ptyClose(terminalId)
      .then(() => {
        console.info(
          "[WorkspaceTerminalPane] ptyClose succeeded",
          JSON.stringify({ terminalId }),
        );
      })
      .catch((error) => {
        console.warn(
          "[WorkspaceTerminalPane] ptyClose failed",
          JSON.stringify({
            terminalId,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      });
    terminalRefs.current.delete(terminalId);
    console.info(
      "[WorkspaceTerminalPane] terminal ref deleted",
      JSON.stringify({ terminalId }),
    );
    setShellTerminals((prev) => prev.filter((t) => t.id !== terminalId));
    setTerminalOrder((prev) => prev.filter((id) => id !== terminalId));
    if (activePtySessionId === terminalId) {
      console.info(
        "[WorkspaceTerminalPane] clearing active shell session",
        JSON.stringify({ terminalId }),
      );
      setActivePtySessionId(null);
    }
  };

  // Close Claude session
  const handleCloseClaudeSession = (sessionId: number) => {
    const claudeTerminalId = `claude-${sessionId}`;
    console.info(
      "[WorkspaceTerminalPane] agent session close requested",
      JSON.stringify({
        sessionId,
        claudeTerminalId,
        activePtySessionId,
      }),
    );
    const sessionData = claudeSessions.find((s) => s.sessionId === sessionId);
    if (sessionData) {
      // ptyClose(sessionData.ptySessionId).catch(console.error);
      terminalRefs.current.delete(claudeTerminalId);
      console.info(
        "[WorkspaceTerminalPane] agent terminal ref deleted",
        JSON.stringify({
          sessionId,
          claudeTerminalId,
          ptySessionId: sessionData.ptySessionId,
        }),
      );
    }
    setMountedClaudeSessions((prev) => {
      const next = new Set(prev);
      next.delete(sessionId);
      return next;
    });
    setTerminalOrder((prev) => prev.filter((id) => id !== claudeTerminalId));
    onCloseSession?.(sessionId);
    console.info(
      "[WorkspaceTerminalPane] onCloseSession callback fired",
      JSON.stringify({ sessionId }),
    );
    if (activePtySessionId === claudeTerminalId) {
      console.info(
        "[WorkspaceTerminalPane] clearing active agent session",
        JSON.stringify({ sessionId, claudeTerminalId }),
      );
      setActivePtySessionId(null);
    }
  };

  // Terminal width resize handler
  const handleTerminalResize = (
    leftId: string,
    rightId: string,
    deltaX: number,
  ) => {
    if (!scrollContainerRef.current) return;

    setTerminalWidths((prev) => {
      const newWidths = new Map(prev);
      const container = scrollContainerRef.current;
      if (!container) return prev;

      // Minimum width is 2/5 of scroll container viewport
      const minWidth = containerWidth * 0.4 || 300;

      // Get current widths - if null, calculate from actual element width
      const leftEl = container.querySelector(
        `[data-terminal-id="${leftId}"]`,
      ) as HTMLElement | null;
      const rightEl = container.querySelector(
        `[data-terminal-id="${rightId}"]`,
      ) as HTMLElement | null;

      if (!leftEl || !rightEl) return prev;

      const leftCurrentWidth =
        prev.get(leftId) ?? leftEl.getBoundingClientRect().width;
      const rightCurrentWidth =
        prev.get(rightId) ?? rightEl.getBoundingClientRect().width;

      // Calculate new widths
      let newLeftWidth = leftCurrentWidth + deltaX;
      let newRightWidth = rightCurrentWidth - deltaX;

      // Enforce minimum widths
      if (newLeftWidth < minWidth) {
        const diff = minWidth - newLeftWidth;
        newLeftWidth = minWidth;
        newRightWidth -= diff;
      }
      if (newRightWidth < minWidth) {
        const diff = minWidth - newRightWidth;
        newRightWidth = minWidth;
        newLeftWidth -= diff;
      }

      // Don't update if either would be below minimum
      if (newLeftWidth < minWidth || newRightWidth < minWidth) {
        return prev;
      }

      newWidths.set(leftId, newLeftWidth);
      newWidths.set(rightId, newRightWidth);

      return newWidths;
    });
  };

  // Show ALL mounted Claude sessions (no workspace filtering)
  const claudeSessionsToRender = claudeSessions.filter((s) => {
    const isActiveSession = activeClaudeSessionId === s.sessionId;
    return isActiveSession || mountedClaudeSessions.has(s.sessionId);
  });

  useTerminalPaneKeyboardShortcuts({
    setCollapsed,
    maximized,
    setMaximized,
    handleCreateAgentSession,
    handleAddShell,
    activePtySessionId,
    claudeSessions,
    handleCloseShell,
    handleCloseClaudeSession,
  });

  // Build ordered list of all terminals for rendering based on terminalOrder
  const shellTerminalMap = new Map(shellTerminals.map((t) => [t.id, t]));
  const claudeSessionMap = new Map(
    claudeSessionsToRender.map((s) => [`claude-${s.sessionId}`, s]),
  );

  const orderedTerminals: Array<
    | { type: "shell"; data: ShellTerminalData }
    | { type: "claude"; data: ClaudeSessionData }
  > = terminalOrder
    .map((id) => {
      if (id.startsWith("shell-")) {
        const shellData = shellTerminalMap.get(id);
        if (shellData) {
          return { type: "shell" as const, data: shellData };
        }
      } else if (id.startsWith("claude-")) {
        const claudeData = claudeSessionMap.get(id);
        if (claudeData) {
          return { type: "claude" as const, data: claudeData };
        }
      }
      return null;
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);

  // Ensure newly created Claude sessions render immediately even before their IDs
  // are added to terminalOrder (e.g., pending agent sessions).
  const missingClaudeTerminals = claudeSessionsToRender
    .filter((session) => !terminalOrder.includes(`claude-${session.sessionId}`))
    .map((session) => ({ type: "claude" as const, data: session }));

  const allTerminals = [...orderedTerminals, ...missingClaudeTerminals];

  // Auto-collapse when all terminals are closed
  useEffect(() => {
    if (allTerminals.length === 0) {
      setCollapsed(true);
      setMaximized(false);
    }
  }, [allTerminals.length]);

  // Track last-activity timestamp + streaming state per terminal id, for
  // the sidebar's terminal sessions list (ordering, idle icon, spinner).
  const {
    handleTerminalOutput,
    handleTerminalInput,
    handleTerminalIdlePulse,
    terminalSummariesRef,
  } = useTerminalSessionSummaries({
    allTerminals,
    workspaceBranchByPath,
    currentBranch,
    onTerminalsChange,
  });

  const {
    handleFocusTerminalById,
    handleCloseTerminalById,
    handleCloseIdleTerminals,
    handleCloseAllTerminals,
    closeTerminalsForWorkspace,
  } = useTerminalSessionActions({
    claudeSessions,
    shellTerminals,
    workspaceBranchByPath,
    terminalSummariesRef,
    setCollapsed,
    setMountedClaudeSessions,
    setTerminalOrder,
    setActivePtySessionId,
    onActiveSessionChange,
    onNavigateToWorkspace,
    scrollToTerminal,
    handleCloseClaudeSession,
    handleCloseShell,
  });

  // Expose methods via ref for command palette + sidebar terminal list
  useImperativeHandle(
    ref,
    () => ({
      toggleCollapse: () => setCollapsed((prev) => !prev),
      toggleMaximize: () => {
        if (maximized) {
          setMaximized(false);
        } else {
          setCollapsed(false);
          setMaximized(true);
        }
      },
      createAgentSession: handleCreateAgentSession,
      createShellSession: handleAddShell,
      closeTerminalsForWorkspace,
      focusTerminal: handleFocusTerminalById,
      closeTerminal: handleCloseTerminalById,
      closeIdleTerminals: handleCloseIdleTerminals,
      closeAllTerminals: handleCloseAllTerminals,
    }),
    [
      maximized,
      handleCreateAgentSession,
      handleAddShell,
      closeTerminalsForWorkspace,
      handleFocusTerminalById,
      handleCloseTerminalById,
      handleCloseIdleTerminals,
      handleCloseAllTerminals,
    ],
  );

  const workspaceGroups = buildWorkspaceGroups(allTerminals, claudeSessions);

  // Scroll to workspace group and focus first terminal when workingDirectory changes
  useEffect(() => {
    if (collapsed || !scrollContainerRef.current) return;
    const matchingGroup = workspaceGroups.find(
      (g) => g.workspaceKey === workingDirectory,
    );
    if (!matchingGroup || matchingGroup.terminals.length === 0) return;

    // Scroll the group element into view
    requestAnimationFrame(() => {
      const groupEl = scrollContainerRef.current?.querySelector(
        `[data-workspace-group="${CSS.escape(matchingGroup.workspaceKey)}"]`,
      );
      if (groupEl) {
        groupEl.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "start",
        });
      }
    });

    // Set the first terminal in the group as active
    const [firstTerminal] = matchingGroup.terminals;
    if (firstTerminal.type === "shell") {
      setActivePtySessionId(firstTerminal.data.id);
    } else {
      setActivePtySessionId(firstTerminal.data.ptySessionId);
    }
  }, [workingDirectory]);

  const totalTerminals = allTerminals.length;

  return (
    <WorkspaceTerminalPaneView
      paneRef={paneRef}
      className={className}
      collapsed={collapsed}
      maximized={maximized}
      height={height}
      isResizingHeight={isResizingHeight}
      handleHeightResizeMouseDown={handleHeightResizeMouseDown}
      totalTerminals={totalTerminals}
      handleCreateAgentSession={handleCreateAgentSession}
      handleAddShell={handleAddShell}
      setCollapsed={setCollapsed}
      setMaximized={setMaximized}
      scrollContainerRef={scrollContainerRef}
      workspaceGroups={workspaceGroups}
      containerWidth={containerWidth}
      onNavigateToWorkspace={onNavigateToWorkspace}
      currentBranch={currentBranch}
      activePtySessionId={activePtySessionId}
      setActivePtySessionId={setActivePtySessionId}
      handleCloseShell={handleCloseShell}
      onSessionError={onSessionError}
      terminalRefs={terminalRefs}
      terminalWidths={terminalWidths}
      handleTerminalResize={handleTerminalResize}
      handleCloseClaudeSession={handleCloseClaudeSession}
      onTerminalDoubleClick={handleTerminalDoubleClick}
      onTerminalOutput={handleTerminalOutput}
      onTerminalInput={handleTerminalInput}
      onTerminalIdle={handleTerminalIdlePulse}
    />
  );
};

export const WorkspaceTerminalPane = WorkspaceTerminalPaneInner;
