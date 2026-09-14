import useSWR from "swr";
import { getSetting, getWorkspaces } from "../lib/api";
import { RemoteConnectPanel } from "./RemoteConnectPanel";

/**
 * Mobile-optimized top-level layout. Runs on the same Tauri backend and IPC
 * commands as the desktop Dashboard, but renders a single-column,
 * touch-first shell instead of the desktop's multi-pane layout.
 */
export function MobileShell() {
  const { data: repoPath } = useSWR("mobile-shell-last-repo-path", () =>
    getSetting("lastRepoPath"),
  );
  const { data: workspaces, error } = useSWR(
    repoPath ? ["mobile-shell-workspaces", repoPath] : null,
    () => getWorkspaces(repoPath as string),
  );

  return (
    <div className="flex h-screen flex-col overflow-y-auto">
      <header className="sticky top-0 z-10 border-b bg-background px-4 py-3">
        <h1 className="text-lg font-semibold">Treq</h1>
      </header>
      <main className="flex-1 px-4 py-3">
        {!repoPath && (
          <p className="text-sm text-muted-foreground">
            No repository selected yet.
          </p>
        )}
        {error && <p className="text-sm text-destructive">{String(error)}</p>}
        {repoPath && workspaces && (
          <ul className="flex flex-col gap-2">
            {workspaces.map((ws) => (
              <li key={ws.id} className="rounded-md border px-3 py-2 text-sm">
                {ws.workspace_name}
              </li>
            ))}
          </ul>
        )}
        <RemoteConnectPanel />
      </main>
    </div>
  );
}
