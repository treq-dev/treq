import type { Ref } from "react";
import {
  type ClaudeSessionData,
  type TerminalSessionSummary,
} from "../terminal/types";

export interface ShellTerminalData {
  id: string;
  workingDirectory: string;
  remoteHost?: string;
}

export interface WorkspaceTerminalPaneProps {
  ref?: Ref<WorkspaceTerminalPaneHandle>;
  workingDirectory: string;
  remoteHost?: string;
  onSessionError?: (message: string) => void;
  currentBranch?: string | null;
  claudeSessions?: ClaudeSessionData[];
  activeClaudeSessionId?: number | null;
  onActiveSessionChange?: (sessionId: number | null) => void;
  onCreateNewSession?: (
    activeWorkspacePath?: string | null,
    agent?: "claude" | "codex" | "cursor" | "copilot",
  ) => void;
  onCloseSession?: (sessionId: number) => void;
  onNavigateToWorkspace?: (workspaceKey: string, isMainRepo: boolean) => void;
  /** Full workspace path -> branch name, used to resolve shell terminal branches for the sidebar list. */
  workspaceBranchByPath?: Map<string, string>;
  /** Reports the up-to-date list of terminal sessions for the sidebar's terminal list. */
  onTerminalsChange?: (summaries: TerminalSessionSummary[]) => void;
  className?: string;
}

export interface WorkspaceTerminalPaneHandle {
  toggleCollapse: () => void;
  toggleMaximize: () => void;
  createAgentSession: (
    agent?: "claude" | "codex" | "cursor" | "copilot",
  ) => void;
  createShellSession: (workingDir?: string) => void;
  closeTerminalsForWorkspace: (workspaceKey: string) => void;
  focusTerminal: (id: string) => void;
  closeTerminal: (id: string) => void;
  closeIdleTerminals: () => void;
  closeAllTerminals: () => void;
}

export type TerminalEntry =
  | { type: "shell"; data: ShellTerminalData }
  | { type: "claude"; data: ClaudeSessionData };

export interface TerminalWithWorkspace {
  terminal: TerminalEntry;
  workspace: {
    workspaceKey: string;
    workspaceName: string;
    isMainRepo: boolean;
  };
}
