import type {
  JjFileChange,
  JjFileDiff,
  JjFileLines,
  JjLogResult,
  JjRevisionDiff,
  RepoBranch,
  Workspace,
  WorkspaceSidebarStatus,
  WorkspaceStatus,
} from "./api-types";
import type { WorkspaceChangeMarker } from "./api-types-remote";
import {
  isRemoteRepository,
  matchesActiveCanonicalPath,
  peekActiveRepository,
  type ActiveRepository,
} from "./active-repository";
import {
  dispatch,
  dispatchMutation,
  type TreqCommandRequest,
} from "./remote-dispatch";
import { applyMutationDispatchResult } from "./remote-mutation-ui";
import { useRemoteCutoffStore } from "../stores/remoteCutoffStore";

function workspaceArg(workspaceId: number | null | undefined): string | null {
  if (workspaceId == null) return null;
  return String(workspaceId);
}

function activeForPath(repoPath: string): ActiveRepository | null {
  const active = peekActiveRepository();
  if (!isRemoteRepository(active)) return null;
  if (!matchesActiveCanonicalPath(active, repoPath)) return null;
  return active;
}

function noteCutoffFromError(error: unknown, endpointId: string | null) {
  if (!endpointId) return;
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("credential_cutoff") && !message.includes("CredentialCutOff")) {
    return;
  }
  useRemoteCutoffStore.getState().recordCutoff(endpointId, "certificate_expired");
}

async function remoteDispatch<T>(
  repo: ActiveRepository,
  request: TreqCommandRequest,
): Promise<T> {
  try {
    return await dispatch<T>(repo.endpoint, request);
  } catch (error) {
    noteCutoffFromError(error, repo.endpointId);
    throw error;
  }
}

export function isRemoteTransportPath(repoPath: string): boolean {
  return activeForPath(repoPath) != null;
}

export async function transportGetWorkspaces(
  repoPath: string,
  local: () => Promise<Workspace[]>,
): Promise<Workspace[]> {
  const repo = activeForPath(repoPath);
  if (!repo) return local();
  return remoteDispatch<Workspace[]>(repo, {
    kind: "ListWorkspaces",
    repo: repo.canonicalPath,
  });
}

export async function transportListWorkspaceStatuses(
  repoPath: string,
  local: () => Promise<WorkspaceSidebarStatus[]>,
): Promise<WorkspaceSidebarStatus[]> {
  const repo = activeForPath(repoPath);
  if (!repo) return local();
  const workspaces = await transportGetWorkspaces(repoPath, async () => []);
  return Promise.all(
    workspaces.map(async (workspace) => {
      try {
        const detailed = await transportGetWorkspaceStatus(
          repoPath,
          workspace.id,
          async () =>
            ({
              current: workspace,
              has_conflicts: false,
              has_changes: false,
              conflicted_files: [],
              remote_sync: { type: "NotOnRemote" },
              target: null,
              children: [],
              dag_nodes: [],
              conflicted_workspace_ids: [],
              commits_ahead_of_target: [],
            }) as WorkspaceStatus,
        );
        return {
          current: workspace,
          has_conflicts: detailed.has_conflicts,
        };
      } catch {
        return { current: workspace, has_conflicts: false };
      }
    }),
  );
}

export async function transportGetWorkspaceStatus(
  repoPath: string,
  workspaceId: number | null,
  local: () => Promise<WorkspaceStatus>,
): Promise<WorkspaceStatus> {
  const repo = activeForPath(repoPath);
  if (!repo) return local();
  if (workspaceId == null) {
    return remoteDispatch<WorkspaceStatus>(repo, {
      kind: "RepositoryStatus",
      repo: repo.canonicalPath,
    });
  }
  return remoteDispatch<WorkspaceStatus>(repo, {
    kind: "InspectWorkspace",
    repo: repo.canonicalPath,
    workspace: String(workspaceId),
  });
}

export async function transportGetRepoCurrentBranch(
  repoPath: string,
  local: () => Promise<RepoBranch>,
): Promise<RepoBranch> {
  const repo = activeForPath(repoPath);
  if (!repo) return local();
  const inspection = await remoteDispatch<{
    current_branch: string | null;
    default_branch?: string;
  }>(repo, { kind: "InspectRepository", repo: repo.canonicalPath });
  return {
    current_branch: inspection.current_branch,
    display_ref: inspection.current_branch ?? inspection.default_branch ?? "",
    is_detached: false,
  };
}

export async function transportGetRepoDefaultBranch(
  repoPath: string,
  local: () => Promise<string>,
): Promise<string> {
  const repo = activeForPath(repoPath);
  if (!repo) return local();
  const inspection = await remoteDispatch<{ default_branch: string }>(repo, {
    kind: "InspectRepository",
    repo: repo.canonicalPath,
  });
  return inspection.default_branch;
}

export async function transportListRepoBranches<T>(
  repoPath: string,
  local: () => Promise<T>,
): Promise<T> {
  const repo = activeForPath(repoPath);
  if (!repo) return local();
  return remoteDispatch<T>(repo, {
    kind: "ListBranches",
    repo: repo.canonicalPath,
  });
}

export async function transportGetWorkspaceChangedFiles(
  repoPath: string,
  workspaceId: number | null,
  local: () => Promise<JjFileChange[]>,
): Promise<JjFileChange[]> {
  const repo = activeForPath(repoPath);
  if (!repo) return local();
  return remoteDispatch<JjFileChange[]>(repo, {
    kind: "ListChanges",
    repo: repo.canonicalPath,
    workspace: workspaceArg(workspaceId),
  });
}

export async function transportListCommits(
  repoPath: string,
  workspaceId: number | null,
  local: () => Promise<JjLogResult>,
): Promise<JjLogResult> {
  const repo = activeForPath(repoPath);
  if (!repo) return local();
  const result = await remoteDispatch<JjLogResult | { commits?: JjLogResult["commits"] }>(
    repo,
    {
      kind: "ListCommits",
      repo: repo.canonicalPath,
      workspace: workspaceArg(workspaceId),
    },
  );
  if (Array.isArray(result)) {
    return { commits: result } as JjLogResult;
  }
  return result as JjLogResult;
}

export async function transportListConflicts(
  repoPath: string,
  workspaceId: number | null,
): Promise<string[]> {
  const repo = activeForPath(repoPath);
  if (!repo) return [];
  const result = await remoteDispatch<string[] | { path: string }[]>(repo, {
    kind: "ListConflicts",
    repo: repo.canonicalPath,
    workspace: workspaceArg(workspaceId),
  });
  if (!Array.isArray(result)) return [];
  return result.map((item) => (typeof item === "string" ? item : item.path));
}

export async function transportGetWorkspaceDiff(
  repoPath: string,
  workspaceId: number,
  local: () => Promise<JjRevisionDiff>,
): Promise<JjRevisionDiff> {
  const repo = activeForPath(repoPath);
  if (!repo) return local();
  const [uncommitted, conflicted] = await Promise.all([
    transportGetWorkspaceChangedFiles(repoPath, workspaceId, async () => []),
    transportListConflicts(repoPath, workspaceId),
  ]);
  const hunks_by_file: JjFileDiff[] = [];
  for (const file of uncommitted) {
    const hunks = await remoteDispatch<JjFileDiff["hunks"]>(repo, {
      kind: "DiffFile",
      repo: repo.canonicalPath,
      workspace: workspaceArg(workspaceId),
      path: file.path,
    });
    hunks_by_file.push({ path: file.path, hunks: hunks ?? [] });
  }
  return {
    uncommitted_files: uncommitted,
    committed_files: [],
    conflicted_files: conflicted,
    hunks_by_file,
    too_large_to_render: false,
  };
}

export async function transportGetWorkspaceFileHunksBatch<T>(
  repoPath: string,
  workspaceId: number | null,
  filePaths: string[],
  local: () => Promise<T>,
): Promise<T> {
  const repo = activeForPath(repoPath);
  if (!repo) return local();
  const files = await Promise.all(
    filePaths.map(async (path) => {
      const hunks = await remoteDispatch<JjFileDiff["hunks"]>(repo, {
        kind: "DiffFile",
        repo: repo.canonicalPath,
        workspace: workspaceArg(workspaceId),
        path,
      });
      return { path, content_hash: "", hunks: hunks ?? [] };
    }),
  );
  return { snapshotToken: "remote", files } as T;
}

export async function transportGetWorkspaceFileLines(
  repoPath: string,
  workspaceId: number | null,
  filePath: string,
  fromParent: boolean,
  startLine: number,
  endLine: number,
  local: () => Promise<JjFileLines>,
): Promise<JjFileLines> {
  const repo = activeForPath(repoPath);
  if (!repo) return local();
  return remoteDispatch<JjFileLines>(repo, {
    kind: "ReadFile",
    repo: repo.canonicalPath,
    workspace: workspaceArg(workspaceId),
    path: filePath,
    revision: fromParent ? "Parent" : "WorkingCopy",
    start_line: startLine,
    end_line: endLine,
  });
}

export async function transportChangeMarker(
  repo: ActiveRepository,
  workspaceId: number | null | undefined,
): Promise<WorkspaceChangeMarker> {
  return remoteDispatch<WorkspaceChangeMarker>(repo, {
    kind: "WorkspaceChangeMarker",
    repo: repo.canonicalPath,
    workspace: workspaceArg(workspaceId ?? null),
  });
}

export async function transportCreateCommit(
  repoPath: string,
  workspaceId: number | null,
  message: string,
  local: () => Promise<string>,
): Promise<string> {
  const repo = activeForPath(repoPath);
  if (!repo) return local();
  const result = await dispatchMutation<string>(repo.endpoint, {
    kind: "CreateCommit",
    repo: repo.canonicalPath,
    workspace: workspaceArg(workspaceId),
    message,
  });
  const value = applyMutationDispatchResult(result);
  if (result.status === "ambiguous") {
    throw new Error(result.reason);
  }
  return value ?? "Commit applied";
}

export async function transportGitFetch(
  repoPath: string,
  local: () => Promise<void>,
): Promise<void> {
  const repo = activeForPath(repoPath);
  if (!repo) return local();
  const result = await dispatchMutation(repo.endpoint, {
    kind: "GitFetch",
    repo: repo.canonicalPath,
  });
  applyMutationDispatchResult(result);
  if (result.status === "ambiguous") {
    throw new Error(result.reason);
  }
}
