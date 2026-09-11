export type WorkspaceStatusIndicator =
  | { shape: "triangle" }
  | {
      shape: "dot";
      color: "red" | "yellow" | "blue";
      spin: boolean;
      label: string;
    };

export const WORKSPACE_STATUS_DOT_TEXT_CLASS: Record<
  "red" | "yellow" | "blue",
  string
> = {
  red: "text-destructive",
  yellow: "text-yellow-500",
  blue: "text-blue-500",
};

export const WORKSPACE_STATUS_DOT_BG_CLASS: Record<
  "red" | "yellow" | "blue",
  string
> = {
  red: "bg-destructive",
  yellow: "bg-yellow-500",
  blue: "bg-blue-500",
};

/**
 * Sidebar row indicator: a static conflict triangle with no agent session,
 * otherwise a color-coded dot (spinning while an agent session streams) --
 * red for conflicts, yellow for uncommitted changes, blue otherwise.
 */
export function getWorkspaceStatusIndicator(params: {
  isConflicted: boolean;
  hasChanges: boolean;
  hasActiveAgentSession: boolean;
  isAgentSessionStreaming: boolean;
}): WorkspaceStatusIndicator | null {
  const {
    isConflicted,
    hasChanges,
    hasActiveAgentSession,
    isAgentSessionStreaming,
  } = params;
  if (isConflicted) {
    if (!hasActiveAgentSession) return { shape: "triangle" };
    return {
      shape: "dot",
      color: "red",
      spin: isAgentSessionStreaming,
      label: "Conflicted workspace",
    };
  }
  if (hasActiveAgentSession) {
    return {
      shape: "dot",
      color: hasChanges ? "yellow" : "blue",
      spin: isAgentSessionStreaming,
      label: hasChanges
        ? "Agent session, uncommitted changes"
        : "Agent session",
    };
  }
  if (hasChanges) {
    return {
      shape: "dot",
      color: "yellow",
      spin: false,
      label: "Uncommitted changes",
    };
  }
  return null;
}
