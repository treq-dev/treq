import { useKeyboardShortcut } from "../../hooks/useKeyboard";
import { type AgentSessionData } from "../terminal/types";

interface UseTerminalPaneKeyboardShortcutsOptions {
  setCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  maximized: boolean;
  setMaximized: React.Dispatch<React.SetStateAction<boolean>>;
  handleCreateAgentSession: () => void;
  handleAddShell: () => void;
  activePtySessionId: string | null;
  agentSessions: AgentSessionData[];
  handleCloseShell: (terminalId: string) => void;
  handleCloseAgentSession: (sessionId: number) => void;
}

/** Registers the terminal pane's global keyboard shortcuts (Cmd+J, Cmd+], Cmd+\, Cmd+W, ...). */
export function useTerminalPaneKeyboardShortcuts({
  setCollapsed,
  maximized,
  setMaximized,
  handleCreateAgentSession,
  handleAddShell,
  activePtySessionId,
  agentSessions,
  handleCloseShell,
  handleCloseAgentSession,
}: UseTerminalPaneKeyboardShortcutsOptions) {
  // Cmd+J: Toggle bottom terminal pane
  useKeyboardShortcut(
    "j",
    true,
    () => {
      setCollapsed((prev) => !prev);
    },
    [],
  );

  // Cmd+Control+J: Toggle maximize/restore terminal pane
  useKeyboardShortcut(
    "j",
    true,
    () => {
      if (maximized) {
        // If already maximized, restore to expanded state
        setMaximized(false);
      } else {
        // If collapsed or expanded, maximize
        setCollapsed(false);
        setMaximized(true);
      }
    },
    [maximized],
    { requireBothCmdAndCtrl: true },
  );

  // Cmd+]: Create new agent terminal
  useKeyboardShortcut(
    "]",
    true,
    () => {
      handleCreateAgentSession();
    },
    [handleCreateAgentSession],
  );

  // Cmd+\: Create new shell terminal
  useKeyboardShortcut(
    "\\",
    true,
    () => {
      handleAddShell();
    },
    [handleAddShell],
  );

  // Cmd+W: Close the selected terminal (never closes the treq window)
  useKeyboardShortcut(
    "w",
    true,
    () => {
      if (!activePtySessionId) return;
      if (activePtySessionId.startsWith("shell-")) {
        handleCloseShell(activePtySessionId);
        return;
      }
      const agentSession = agentSessions.find(
        (s) => s.ptySessionId === activePtySessionId,
      );
      if (agentSession) {
        handleCloseAgentSession(agentSession.sessionId);
      }
    },
    [
      activePtySessionId,
      agentSessions,
      handleCloseShell,
      handleCloseAgentSession,
    ],
  );
}
