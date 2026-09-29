import { type AgentSessionData } from "../terminal/types";
import { type ShellTerminalData } from "./types";
import { agentSessionIdOf } from "../terminal/agentTerminalId";

interface UseTerminalSessionActionsOptions {
  agentSessions: AgentSessionData[];
  shellTerminals: ShellTerminalData[];
  workspaceBranchByPath?: Map<string, string>;
  setCollapsed: (collapsed: boolean) => void;
  setMountedAgentSessions: React.Dispatch<React.SetStateAction<Set<number>>>;
  setTerminalOrder: React.Dispatch<React.SetStateAction<string[]>>;
  setActivePtySessionId: React.Dispatch<React.SetStateAction<string | null>>;
  onActiveSessionChange?: (sessionId: number | null) => void;
  onNavigateToWorkspace?: (workspaceKey: string, isMainRepo: boolean) => void;
  scrollToTerminal: (terminalId: string) => void;
  handleCloseAgentSession: (sessionId: number) => void;
  handleCloseShell: (terminalId: string) => void;
}

/**
 * Focus and close actions keyed by the composite ids used in `terminalOrder`
 * ("shell-..." / "agent-<sessionId>").
 */
export function useTerminalSessionActions({
  agentSessions,
  shellTerminals,
  workspaceBranchByPath,
  setCollapsed,
  setMountedAgentSessions,
  setTerminalOrder,
  setActivePtySessionId,
  onActiveSessionChange,
  onNavigateToWorkspace,
  scrollToTerminal,
  handleCloseAgentSession,
  handleCloseShell,
}: UseTerminalSessionActionsOptions) {
  const handleFocusTerminalById = (id: string) => {
    setCollapsed(false);
    const sessionId = agentSessionIdOf(id);
    if (sessionId !== null) {
      const sessionData = agentSessions.find((s) => s.sessionId === sessionId);
      if (!sessionData) return;
      setMountedAgentSessions((prev) =>
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

    agentSessions
      .filter((s) => (s.workspacePath || s.repoPath) === workspaceKey)
      .forEach((s) => handleCloseAgentSession(s.sessionId));
  };

  return {
    handleFocusTerminalById,
    closeTerminalsForWorkspace,
  };
}
