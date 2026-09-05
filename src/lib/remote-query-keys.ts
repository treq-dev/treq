// Query-key identity for remote (SSH-backed) repository data.
//
// Every existing SWR key in this codebase is keyed on `repoPath` as a plain
// string (see `reviewChangeCountQueryKey`, `cachedPrStatusesKey`, etc. in
// `src/lib/review-change-count.ts` and `src/hooks/useMergeQueueStatus.ts`).
// For a remote repository, `repoPath` alone is not a safe cache key: the
// same hostname/path pair can point at a different filesystem after a
// managed-VM reprovision (new generation, same endpoint id) or after an
// endpoint is deleted and re-registered (same alias, different endpoint id).
// A local repo can also happen to share a path string with a remote one.
//
// `remoteRepoIdentity` folds endpoint id, endpoint generation, and workspace
// id into one opaque string that existing call sites can drop in wherever
// they currently pass `repoPath`, so local and remote cache entries - and
// stale-vs-fresh remote generations - cannot collide. It intentionally
// returns a single string (not a key array) so it composes with any
// existing `[...] as const` key tuple without changing key shape.

import type { RepositoryLocation } from "./api-types-remote";

export type RemoteIdentityOptions = {
  endpointGeneration?: number;
  endpointId?: string | null;
};

/**
 * Builds the identity string a query key should use in place of a bare
 * `repoPath` for a location that may be remote. Local locations are
 * returned unchanged (matching every existing call site's current
 * behavior); remote locations fold in endpoint id (or host) and generation.
 */
export function remoteRepoIdentity(
  location: RepositoryLocation,
  endpointGenerationOrOptions?: number | RemoteIdentityOptions,
): string {
  const options: RemoteIdentityOptions =
    typeof endpointGenerationOrOptions === "object"
      ? endpointGenerationOrOptions
      : { endpointGeneration: endpointGenerationOrOptions };
  if (location.type === "local") return location.path;
  const generation = options.endpointGeneration ?? 0;
  const endpoint = options.endpointId || location.host;
  return `ssh:${endpoint}:gen${generation}:${location.path}`;
}

/**
 * Extends an identity string with a workspace id, for keys that are also
 * scoped per-workspace (e.g. changed files, commits, conflicts).
 */
export function remoteWorkspaceIdentity(
  repoIdentity: string,
  workspaceId: number | string | null,
): string {
  return `${repoIdentity}::workspace:${workspaceId ?? "none"}`;
}

/**
 * Derives a `RepositoryLocation` from the legacy `{ host, path }` shape the
 * placeholder remote-SSH flow used, so existing `RemoteRepository` values can
 * feed the new identity helpers without a data migration.
 */
export function locationFromHostAndPath(
  host: string | undefined,
  path: string | undefined,
): RepositoryLocation | undefined {
  if (!host || !path) return undefined;
  return { type: "ssh", host, path };
}
