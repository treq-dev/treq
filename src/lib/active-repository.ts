import type { RemoteRepository, SshEndpoint } from "./api-types-remote";
import type { RepositoryLocation } from "./api-types-remote";
import { remoteRepoIdentity } from "./remote-query-keys";

/**
 * Transport-aware descriptor for the repository the desktop UI is showing.
 * Local and SSH repositories share this shape so cache keys, adapters, and
 * the workspace tree do not branch on a parallel "remote screen".
 */
export interface ActiveRepository {
  id: string;
  location: RepositoryLocation;
  endpoint: SshEndpoint | null;
  endpointId: string | null;
  endpointGeneration: number;
  canonicalPath: string;
  displayName: string;
}

export function isRemoteRepository(
  repo: ActiveRepository | null | undefined,
): repo is ActiveRepository & { location: { type: "ssh"; host: string; path: string } } {
  return repo?.location.type === "ssh";
}

export function localActiveRepository(path: string): ActiveRepository {
  return {
    id: path,
    location: { type: "local", path },
    endpoint: null,
    endpointId: null,
    endpointGeneration: 0,
    canonicalPath: path,
    displayName: path,
  };
}

export function repositoryCacheKey(repo: ActiveRepository): string {
  return remoteRepoIdentity(repo.location, {
    endpointGeneration: repo.endpointGeneration,
    endpointId: repo.endpointId ?? repo.endpoint?.id ?? null,
  });
}

export type PersistedRemoteRepository = RemoteRepository & {
  endpoint?: SshEndpoint | null;
  endpoint_id?: string | null;
  endpoint_generation?: number | null;
};

export function activeRepositoryFromRemote(
  saved: PersistedRemoteRepository,
  endpoint?: SshEndpoint | null,
): ActiveRepository {
  const sshEndpoint = endpoint ?? saved.endpoint ?? null;
  const location: RepositoryLocation =
    saved.inspection?.descriptor?.location ?? {
      type: "ssh",
      host: saved.host,
      path: saved.path,
    };
  const canonicalPath = location.type === "ssh" ? location.path : location.path;
  const endpointId =
    sshEndpoint?.id ?? saved.endpoint_id ?? saved.inspection?.descriptor?.id ?? null;
  const generation =
    saved.endpoint_generation ??
    (sshEndpoint?.source &&
    typeof sshEndpoint.source === "object" &&
    "generation" in sshEndpoint.source
      ? Number(sshEndpoint.source.generation)
      : 0);
  return {
    id: saved.inspection?.descriptor?.id ?? `${saved.host}:${saved.path}`,
    location,
    endpoint: sshEndpoint,
    endpointId,
    endpointGeneration: generation ?? 0,
    canonicalPath,
    displayName: saved.display_name,
  };
}

let current: ActiveRepository | null = null;

export function peekActiveRepository(): ActiveRepository | null {
  return current;
}

export function setActiveRepositorySingleton(repo: ActiveRepository | null) {
  current = repo;
}

export function matchesActiveCanonicalPath(
  repo: ActiveRepository | null,
  repoPath: string | undefined,
): boolean {
  if (!repo || !repoPath) return false;
  return repo.canonicalPath === repoPath || repositoryCacheKey(repo) === repoPath;
}
