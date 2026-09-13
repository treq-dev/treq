import useSWR from "swr";
import { getWorkspaceStatus, type WorkspaceSidebarStatus } from "../lib/api";

export interface WorkspaceGitDetail {
  has_changes: boolean;
  commits_ahead_of_target_count: number;
}

/**
 * Per-workspace has_changes / commits-ahead detail for the sidebar's
 * git-status indicator, fetched only for non-conflicted workspaces.
 * Deliberately its own SWR key -- not "workspace-statuses" -- because
 * Dashboard.tsx already owns a plain `listWorkspaceStatuses` poll under
 * that key, and SWR shares cached data across every hook using the same key.
 */
export function useWorkspaceGitDetail(params: {
  repoPath: string | undefined;
  cacheKey: string | undefined;
  enabled: boolean;
  statuses: WorkspaceSidebarStatus[];
}): Map<number, WorkspaceGitDetail> | undefined {
  const { repoPath, cacheKey, enabled, statuses } = params;
  const nonConflictedIds = statuses
    .filter((status) => !status.has_conflicts)
    .map((status) => status.current.id)
    .sort((a, b) => a - b);

  const { data } = useSWR(
    cacheKey && enabled && nonConflictedIds.length > 0
      ? ["workspace-git-detail", cacheKey, nonConflictedIds.join(",")]
      : null,
    async () => {
      const entries = await Promise.all(
        nonConflictedIds.map(async (id) => {
          const detailed = await getWorkspaceStatus(repoPath || "", id);
          return [
            id,
            {
              has_changes: detailed.has_changes,
              commits_ahead_of_target_count:
                detailed.commits_ahead_of_target.length,
            },
          ] as const;
        }),
      );
      return new Map(entries);
    },
    { keepPreviousData: true },
  );

  return data;
}
