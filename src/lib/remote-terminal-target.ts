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
import type { PtyLaunchSpec, RemoteAgentId } from "./api-types-remote";

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

/** Agent choices offered by the sidebar and terminal pane. */
export type SidebarAgent = "claude" | "codex" | "cursor" | "copilot";

/**
 * Maps a sidebar agent choice to the remote allow-list. Returns `null` for
 * agents the remote host cannot launch (the backend only accepts a closed
 * set of binaries, and Copilot is not one of them).
 */
export function remoteAgentIdFor(agent: SidebarAgent): RemoteAgentId | null {
  return REMOTE_AGENT_IDS[agent];
}

const REMOTE_AGENT_IDS: Record<SidebarAgent, RemoteAgentId | null> = {
  claude: "claude",
  codex: "codex",
  cursor: "cursor_agent",
  copilot: null,
};

/**
 * Launch spec for a new remote session. The agent binary starts with no
 * extra arguments: the local agent setup (system prompt and settings files
 * written by `prepareAgentAutoCommand`) lives on this machine and cannot be
 * passed to a remote host as typed arguments.
 */
export function remoteLaunchFor(agent: RemoteAgentId | null): PtyLaunchSpec {
  return agent ? { type: "agent", agent, args: [] } : { type: "shell" };
}

/**
 * Label for a new persistent remote session. It names the tmux/screen
 * session on the host, so it must be unique per workspace: a label that is
 * already in use would attach to the existing session instead of starting a
 * new one. The kind prefix keeps labels readable in the reattach list.
 */
export function newRemoteSessionLabel(
  agent: RemoteAgentId | null,
  now: number = Date.now(),
): string {
  return `${agent ?? "shell"}-${now.toString(36)}`;
}
