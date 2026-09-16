/**
 * Resolves where desktop's `RemoteTerminalDialog` (mobile PRD Phase 8)
 * should open a terminal: inside the currently-selected workspace's own
 * checkout directory when Dashboard has one selected, falling back to the
 * repo root (with the fixed `"root"` workspace id) only when no workspace
 * is selected - e.g. right after connecting, before the user has opened a
 * session. This mirrors the fallback shape of mobile's per-workspace
 * `RemoteTerminalScreen` fix, adapted to desktop's repo-level entry point,
 * which does not always have a workspace in scope.
 */
export interface RemoteTerminalTarget {
  workspaceId: string;
  remoteWorkingDirectory: string;
}

export interface SelectedWorkspaceForTerminal {
  workspace_name: string;
  workspace_path: string;
}

export function resolveRemoteTerminalTarget(
  repositoryCanonicalPath: string,
  selectedWorkspace: SelectedWorkspaceForTerminal | null,
): RemoteTerminalTarget {
  if (selectedWorkspace) {
    return {
      workspaceId: selectedWorkspace.workspace_name,
      remoteWorkingDirectory: selectedWorkspace.workspace_path,
    };
  }
  return {
    workspaceId: "root",
    remoteWorkingDirectory: repositoryCanonicalPath,
  };
}
