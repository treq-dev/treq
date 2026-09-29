import { type AgentSessionData } from "../terminal/types";
import { type TerminalEntry } from "./types";

export interface TerminalWorkspaceInfo {
  workspaceKey: string;
  workspaceName: string;
  isMainRepo: boolean;
}

export function resolveTerminalWorkspace(
  terminal: TerminalEntry,
  options: {
    agentSessions: AgentSessionData[];
    workspaceBranchByPath?: Map<string, string>;
    currentBranch?: string | null;
  },
): TerminalWorkspaceInfo {
  const { agentSessions, workspaceBranchByPath, currentBranch } = options;
  const fallbackName = currentBranch || "main";

  if (terminal.type === "agent") {
    const workspaceKey = terminal.data.workspacePath || terminal.data.repoPath;
    const named = terminal.data.workspaceName ?? null;
    return {
      workspaceKey,
      workspaceName: named || fallbackName,
      isMainRepo: !named,
    };
  }

  const workspaceKey = terminal.data.workingDirectory;
  const fromMap = workspaceBranchByPath?.get(workspaceKey) ?? null;
  const matchingClaude = agentSessions.find((session) => {
    const sessionDir = session.workspacePath || session.repoPath;
    return sessionDir === workspaceKey;
  });
  const named = fromMap ?? matchingClaude?.workspaceName ?? null;
  return {
    workspaceKey,
    workspaceName: named || fallbackName,
    isMainRepo: named == null,
  };
}
