import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import useSWR from "swr";
import { getSetting, getWorkspaces } from "../lib/api";
import { RemoteConnectPanel } from "./RemoteConnectPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { MobileDiffView } from "./mobile/MobileDiffView";
import { MobileCommitView } from "./mobile/MobileCommitView";
import { MobileConflictView } from "./mobile/MobileConflictView";

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
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<number | null>(
    null,
  );

  const selectedWorkspace = workspaces?.find(
    (ws) => ws.id === selectedWorkspaceId,
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

        {repoPath && workspaces && !selectedWorkspace && (
          <ul className="flex flex-col gap-2">
            {workspaces.map((ws) => (
              <li key={ws.id}>
                <button
                  type="button"
                  className="w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => setSelectedWorkspaceId(ws.id)}
                >
                  {ws.workspace_name}
                </button>
              </li>
            ))}
          </ul>
        )}

        {repoPath && selectedWorkspace && (
          <div className="flex flex-col gap-3">
            <button
              type="button"
              className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              onClick={() => setSelectedWorkspaceId(null)}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {selectedWorkspace.workspace_name}
            </button>

            <MobileWorkspaceTabs
              repoPath={repoPath}
              workspaceId={selectedWorkspace.id}
            />
          </div>
        )}

        <RemoteConnectPanel />
      </main>
    </div>
  );
}

function MobileWorkspaceTabs({
  repoPath,
  workspaceId,
}: {
  repoPath: string;
  workspaceId: number;
}) {
  const [tab, setTab] = useState<"changes" | "history" | "conflicts">(
    "changes",
  );

  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
      <TabsList>
        <TabsTrigger value="changes">Changes</TabsTrigger>
        <TabsTrigger value="history">History</TabsTrigger>
        <TabsTrigger value="conflicts">Conflicts</TabsTrigger>
      </TabsList>
      <TabsContent value="changes" className="mt-3">
        <MobileDiffView repoPath={repoPath} workspaceId={workspaceId} />
      </TabsContent>
      <TabsContent value="history" className="mt-3">
        <MobileCommitView repoPath={repoPath} workspaceId={workspaceId} />
      </TabsContent>
      <TabsContent value="conflicts" className="mt-3">
        <MobileConflictView repoPath={repoPath} workspaceId={workspaceId} />
      </TabsContent>
    </Tabs>
  );
}
