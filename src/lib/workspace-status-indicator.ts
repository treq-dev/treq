export interface WorkspaceStatusIndicator {
  color: "red" | "yellow";
  spin: boolean;
  label: string;
}

export const WORKSPACE_STATUS_DOT_TEXT_CLASS: Record<"red" | "yellow", string> =
  {
    red: "text-destructive",
    yellow: "text-yellow-500",
  };

export const WORKSPACE_STATUS_DOT_BG_CLASS: Record<"red" | "yellow", string> = {
  red: "bg-destructive",
  yellow: "bg-yellow-500",
};

/**
 * Sidebar row indicator: a color-coded dot -- red for conflicts, yellow for
 * uncommitted changes, nothing when clean -- shown the same way whether or
 * not an agent session is open, but spinning while one is actively streaming.
 */
export function getWorkspaceStatusIndicator(params: {
  isConflicted: boolean;
  hasChanges: boolean;
  isAgentSessionStreaming: boolean;
}): WorkspaceStatusIndicator | null {
  const { isConflicted, hasChanges, isAgentSessionStreaming } = params;
  if (isConflicted) {
    return {
      color: "red",
      spin: isAgentSessionStreaming,
      label: "Conflicted workspace",
    };
  }
  if (hasChanges) {
    return {
      color: "yellow",
      spin: isAgentSessionStreaming,
      label: "Uncommitted changes",
    };
  }
  return null;
}
