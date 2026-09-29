export type WorkspaceStatusColor = "red" | "yellow" | "neutral";

export interface WorkspaceStatusIndicator {
  color: WorkspaceStatusColor;
  spin: boolean;
  label: string;
}

export const WORKSPACE_STATUS_DOT_TEXT_CLASS: Record<
  WorkspaceStatusColor,
  string
> = {
  red: "text-destructive",
  yellow: "text-yellow-500",
  neutral: "text-muted-foreground",
};

export const WORKSPACE_STATUS_DOT_BG_CLASS: Record<
  WorkspaceStatusColor,
  string
> = {
  red: "bg-destructive",
  yellow: "bg-yellow-500",
  neutral: "bg-muted-foreground",
};

/**
 * Sidebar row indicator: a color-coded dot -- red for conflicts, yellow for
 * uncommitted changes, nothing when clean -- that spins while an agent in the
 * workspace is streaming output. A clean workspace with a working agent gets
 * a neutral spinner, so a running agent always shows in the sidebar.
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
  if (isAgentSessionStreaming) {
    return { color: "neutral", spin: true, label: "Agent working" };
  }
  return null;
}
