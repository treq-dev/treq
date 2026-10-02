/**
 * Mirrors the open repository into the window URL's `repo` param. The
 * Dashboard reads that param on mount, so a reload reopens the current repo
 * instead of the one the window was created with.
 */
export function syncRepoUrlParam(repoPath: string): void {
  const url = new URL(window.location.href);
  if (repoPath) url.searchParams.set("repo", repoPath);
  else url.searchParams.delete("repo");
  if (url.href !== window.location.href) {
    window.history.replaceState(window.history.state, "", url);
  }
}
