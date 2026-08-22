import useSWR from "swr";
import { listCommits, type Workspace } from "../../lib/api";
import {
  sumWorkspaceDiffStats,
  type WorkspaceDiffStats,
} from "../../lib/workspace-stack";
import type { MissionControlGroup } from "./buildMissionControlGroups";

/**
 * Resolves Gerrit-style LOC stats for Mission Control workspace groups.
 * Groups are keyed by branch name (or `__main__`); stats come from each
 * matching workspace's commit list.
 */
export function useMissionControlDiffStats({
  open,
  repoPath,
  workspaces,
  groups,
}: {
  open: boolean;
  repoPath?: string;
  workspaces?: Workspace[];
  groups: MissionControlGroup[];
}): {
  diffStatsByWorkspaceKey: Map<string, WorkspaceDiffStats>;
  maxChange: number;
} {
  const workspaceByBranch = (() => {
    const map = new Map<string, Workspace>();
    for (const ws of workspaces ?? []) {
      map.set(ws.branch_name, ws);
    }
    return map;
  })();

  const groupWorkspaceIds = groups.map((group) => {
    if (group.isMainRepo) return null;
    return workspaceByBranch.get(group.workspaceName)?.id ?? null;
  });

  const fetchableIds = groupWorkspaceIds.filter(
    (id): id is number => id != null,
  );
  const { data: commitLists } = useSWR(
    open && repoPath && fetchableIds.length > 0
      ? ["workspace-commits-mission", repoPath, fetchableIds.join(",")]
      : null,
    () =>
      Promise.all(
        fetchableIds.map((workspaceId) => listCommits(repoPath!, workspaceId)),
      ),
  );

  return (() => {
    const commitsById = new Map<
      number,
      Awaited<ReturnType<typeof listCommits>>
    >();
    fetchableIds.forEach((id, index) => {
      const result = commitLists?.[index];
      if (result) commitsById.set(id, result);
    });

    const diffStatsByWorkspaceKey = new Map<string, WorkspaceDiffStats>();
    groups.forEach((group, index) => {
      const workspaceId = groupWorkspaceIds[index];
      if (workspaceId == null) return;
      const data = commitsById.get(workspaceId)?.commits;
      if (!data) return;
      diffStatsByWorkspaceKey.set(
        group.workspaceKey,
        sumWorkspaceDiffStats(data),
      );
    });

    const maxChange = Math.max(
      0,
      ...Array.from(diffStatsByWorkspaceKey.values()).map((stats) =>
        Math.max(stats.insertions, stats.deletions),
      ),
    );

    return { diffStatsByWorkspaceKey, maxChange };
  })();
}
