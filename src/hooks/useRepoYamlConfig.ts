import useSWR from "swr";
import { loadRepoYamlConfig } from "../lib/api";
import type { RepoYamlConfig } from "../lib/api-extra";

export const repoYamlConfigKey = (repoPath: string | undefined) =>
  repoPath ? (["repo-yaml-config", repoPath] as const) : null;

/**
 * Loads `.treq/config.yaml` (caching it to the local DB) via SWR, keyed by
 * repo path so every caller sharing that key sees the same data and a
 * `reload()` from any one of them revalidates it for all.
 */
export function useRepoYamlConfig(repoPath: string | undefined) {
  const { data, error, isLoading, mutate } = useSWR(
    repoYamlConfigKey(repoPath),
    () => loadRepoYamlConfig(repoPath!),
    // Re-reading a small local YAML file is cheap; always refetch on mount
    // (e.g. reopening Settings) instead of reusing a recent cached result.
    { dedupingInterval: 0 },
  );

  return {
    config: data as RepoYamlConfig | undefined,
    loading: isLoading,
    error: error
      ? `Failed to load .treq/config.yaml: ${error instanceof Error ? error.message : String(error)}`
      : null,
    reload: () => mutate(),
  };
}
