import { type ClaudeSessionData } from "../terminal/types";
import { type ShellTerminalData } from "./types";

interface UseTerminalSessionActionsOptions {
  claudeSessions: ClaudeSessionData[];
  shellTerminals: ShellTerminalData[];
  workspaceBranchByPath?: Map<string, string>;
  setCollapsed: (collapsed: boolean) => void;
  setMountedClaudeSessions: React.Dispatch<React.SetStateAction<Set<number>>>;
  setTerminalOrder: React.Dispatch<React.SetStateAction<string[]>>;
  setActivePtySessionId: React.Dispatch<React.SetStateAction<string | null>>;
  onActiveSessionChange?: (sessionId: number | null) => void;
  onNavigateToWorkspace?: (workspaceKey: string, isMainRepo: boolean) => void;
  scrollToTerminal: (terminalId: string) => void;
  handleCloseClaudeSession: (sessionId: number) => void;
  handleCloseShell: (terminalId: string) => void;
}

/**
 * Focus and close actions keyed by the composite ids used in `terminalOrder`
 * ("shell-..." / "claude-<id>").
 */
export function useTerminalSessionActions({
  claudeSessions,
  shellTerminals,
  workspaceBranchByPath,
  setCollapsed,
  setMountedClaudeSessions,
  setTerminalOrder,
  setActivePtySessionId,
  onActiveSessionChange,
  onNavigateToWorkspace,
  scrollToTerminal,
  handleCloseClaudeSession,
  handleCloseShell,
}: UseTerminalSessionActionsOptions) {
  const handleFocusTerminalById = (id: string) => {
    setCollapsed(false);
    if (id.startsWith("claude-")) {
      const sessionId = Number(id.slice("claude-".length));
      const sessionData = claudeSessions.find((s) => s.sessionId === sessionId);
      if (!sessionData) return;
      setMountedClaudeSessions((prev) =>
        prev.has(sessionId) ? prev : new Set(prev).add(sessionId),
      );
      setTerminalOrder((prev) => (prev.includes(id) ? prev : [...prev, id]));
      setActivePtySessionId(sessionData.ptySessionId);
      onActiveSessionChange?.(sessionId);
    } else {
      const shellData = shellTerminals.find((s) => s.id === id);
      if (!shellData) return;
      setActivePtySessionId(id);
      onNavigateToWorkspace?.(
        shellData.workingDirectory,
        !workspaceBranchByPath?.has(shellData.workingDirectory),
      );
    }
    scrollToTerminal(id);
  };

  // Close every terminal (shell + agent) belonging to a workspace, killing their
  // PTY processes. Used when the owning workspace itself is being deleted, so
  // terminals don't linger as orphaned processes.
  const closeTerminalsForWorkspace = (workspaceKey: string) => {
    shellTerminals
      .filter((t) => t.workingDirectory === workspaceKey)
      .forEach((t) => handleCloseShell(t.id));

    claudeSessions
      .filter((s) => (s.workspacePath || s.repoPath) === workspaceKey)
      .forEach((s) => handleCloseClaudeSession(s.sessionId));
  };

  return {
    handleFocusTerminalById,
    closeTerminalsForWorkspace,
  };
}
