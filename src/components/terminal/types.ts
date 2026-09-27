import type { ConsolidatedTerminalHandle } from "../ConsolidatedTerminal";

// Minimum width for each terminal panel (used when multiple terminals)
export const MIN_TERMINAL_WIDTH = 300;

export interface ClaudeSessionData {
  sessionId: number;
  sessionName: string;
  ptySessionId: string;
  workspacePath: string | null;
  workspaceId?: number | null;
  workingDirectoryOverride?: string;
  repoPath: string;
  workspaceName?: string | null; // Branch name or null for main repo
  pendingPrompt?: string; // Optional prompt to send after agent initializes
  permissionMode?: "plan" | "acceptEdits"; // Permission mode for Claude terminal
  agent?: "claude" | "codex" | "cursor" | "copilot";
}

export interface ShellTerminalData {
  id: string;
  workingDirectory: string;
}

export type TerminalRefsMap = Map<string, ConsolidatedTerminalHandle | null>;

/** No *process* output for this long marks a terminal session as idle. */
export const TERMINAL_IDLE_THRESHOLD_MS = 60_000;

export function isTerminalSessionIdle(
  session: { isStreaming: boolean; lastActivityAt: number },
  now: number,
): boolean {
  return (
    !session.isStreaming &&
    now - session.lastActivityAt >= TERMINAL_IDLE_THRESHOLD_MS
  );
}

/**
 * Unified summary of a single terminal (agent or shell) surfaced in the
 * workspace sidebar's terminal sessions list.
 */
export interface TerminalSessionSummary {
  /** Matches the id used in WorkspaceTerminalPane's terminalOrder ("shell-..." or "claude-<sessionId>"). */
  id: string;
  kind: "agent" | "shell";
  name: string;
  /** null when the terminal belongs to the main repo (not a workspace). */
  branchName: string | null;
  isMainRepo: boolean;
  agent?: "claude" | "codex" | "cursor" | "copilot";
  /** Epoch ms of the last output/creation event. */
  lastActivityAt: number;
  /** Epoch ms of the last user input sent to this terminal, or 0 if none. */
  lastUserInputAt: number;
  /** True while output is actively streaming (shows a spinner). */
  isStreaming: boolean;
  /** Newest printable terminal output for Mission Control card previews. */
  previewOutput: string;
}
