import { useRef } from "react";
interface UseCachedWorkspaceChangesOptions {
  enabled?: boolean;
  repoPath?: string | null;
  workspaceId?: number | null;
}

interface CachedWorkspaceChangesResult {
  refresh: () => Promise<void>;
}

/**
 * Hook for managing workspace changes cache.
 * Currently a minimal implementation - the actual caching is done
 * via the jjGetChangedFiles calls in the component.
 */
export function useCachedWorkspaceChanges(
  workspacePath: string,
  options: UseCachedWorkspaceChangesOptions = {},
): CachedWorkspaceChangesResult {
  void workspacePath;
  void options;
  const refreshCallbackRef = useRef<(() => void) | null>(null);

  const refresh = async () => {
    // Trigger any registered refresh callbacks
    refreshCallbackRef.current?.();
  };

  return {
    refresh,
  };
}
