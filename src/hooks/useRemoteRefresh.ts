import { useEffect, useRef } from "react";
import useSWR from "swr";
import type { ActiveRepository } from "../lib/active-repository";
import { isRemoteRepository, repositoryCacheKey } from "../lib/active-repository";
import { transportChangeMarker } from "../lib/repository-adapter";
import { dispatch } from "../lib/remote-dispatch";
import { invalidateRemoteRepositoryData } from "../lib/remote-mutation-ui";

interface RemoteAgentStatus {
  running: boolean;
  should_refresh: boolean;
}

export function useRemoteAgentRefresh(
  repo: ActiveRepository | null,
  workspaceId: number | null,
) {
  const enabled = isRemoteRepository(repo) && workspaceId != null;
  const { data } = useSWR(
    enabled
      ? ["remote-agent-status", repositoryCacheKey(repo), workspaceId]
      : null,
    () =>
      dispatch<RemoteAgentStatus>(repo!.endpoint, {
        kind: "AgentStatus",
        repo: repo!.canonicalPath,
        workspace: String(workspaceId),
      }),
    { refreshInterval: 5_000, dedupingInterval: 2_000 },
  );

  useEffect(() => {
    if (data?.should_refresh) invalidateRemoteRepositoryData();
  }, [data?.should_refresh]);
}

export function useRemoteChangeMarkerWatch(
  repo: ActiveRepository | null,
  workspaceId: number | null,
) {
  const enabled = isRemoteRepository(repo);
  const identity = repo ? repositoryCacheKey(repo) : "";
  const { data } = useSWR(
    enabled ? ["remote-change-marker", identity, workspaceId] : null,
    () => transportChangeMarker(repo!, workspaceId),
    { refreshInterval: 4_000, dedupingInterval: 1_500 },
  );

  const lastSeenOperationId = useRef<string | null>(null);

  useEffect(() => {
    lastSeenOperationId.current = null;
  }, [identity, workspaceId]);

  useEffect(() => {
    const operationId = data?.operation_id;
    if (!operationId || !enabled) return;
    if (lastSeenOperationId.current === null) {
      lastSeenOperationId.current = operationId;
      return;
    }
    if (operationId !== lastSeenOperationId.current) {
      lastSeenOperationId.current = operationId;
      invalidateRemoteRepositoryData();
    }
  }, [data?.operation_id, enabled]);
}
