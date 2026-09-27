import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import useSWR from "swr";
import { getSetting, getWorkspaces } from "../lib/api";
import { listenForAuthCallbacks } from "../lib/auth-deep-link";
import { isMobileBuild } from "../lib/mobile-platform";
import { useAuthStore } from "../stores/authStore";
import { useRemoteCutoffStore } from "../stores/remoteCutoffStore";
import { RemoteConnectPanel } from "./RemoteConnectPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { MobileDiffView } from "./mobile/MobileDiffView";
import { MobileCommitView } from "./mobile/MobileCommitView";
import { MobileConflictView } from "./mobile/MobileConflictView";

/**
 * Mobile top-level layout. Runs on the same Tauri backend and IPC commands
 * as the desktop Dashboard, but renders a single-column, touch-first shell.
 *
 * Mobile is a remote surface (mobile PRD, "Summary"): the flow is sign in,
 * connect, then choose a remote repository and workspace. The local
 * repository views only appear when a desktop dev build previews this shell
 * (`?shell=mobile`); a phone has no local repositories to show.
 */
export function MobileShell() {
  const showLocalPreview = !isMobileBuild();

  // Cutoff events from the SSH transport block remote screens until the
  // user reauthenticates; see `RemoteConnectPanel`.
  useEffect(() => {
    void useRemoteCutoffStore.getState().startListening();
    return () => useRemoteCutoffStore.getState().stopListening();
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-y-auto">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-background px-4 py-3">
        <h1 className="text-lg font-semibold">Treq</h1>
        <MobileAccountControl />
      </header>
      <main className="flex flex-1 flex-col gap-4 px-4 py-3">
        <RemoteConnectPanel />
        {showLocalPreview && <LocalRepositoryPreview />}
      </main>
    </div>
  );
}

/**
 * Sign-in for the mobile shell, backed by the same `useAuthStore` as
 * desktop. "Sign in" opens the web sign-in page in the system browser; it
 * returns to the app through the `treq://auth/callback` deep link, whose
 * token is exchanged for a session here.
 */
function MobileAccountControl() {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const signIn = useAuthStore((s) => s.signIn);
  const signOut = useAuthStore((s) => s.signOut);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    listenForAuthCallbacks((token) => {
      setError(null);
      useAuthStore
        .getState()
        .exchangeToken(token)
        .catch((err: unknown) =>
          setError(err instanceof Error ? err.message : String(err)),
        );
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // The deep-link plugin is unavailable (e.g. a desktop dev preview);
        // desktop's own deep-link listener covers sign-in there.
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  if (user) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-xs text-muted-foreground">
          {user.email}
        </span>
        <button
          type="button"
          onClick={() => void signOut()}
          className="shrink-0 rounded-md border px-2 py-1 text-xs"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => {
          setError(null);
          signIn().catch((err: unknown) =>
            setError(err instanceof Error ? err.message : String(err)),
          );
        }}
        disabled={loading}
        className="rounded-md border px-3 py-1.5 text-sm"
      >
        Sign in
      </button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function LocalRepositoryPreview() {
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
    <section className="flex flex-col gap-3 border-t pt-3">
      <h2 className="text-sm font-semibold">Local repository (dev preview)</h2>
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
    </section>
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
