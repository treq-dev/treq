/**
 * Mobile PTY streaming/reattach UI (mobile remote PRD, Phase 7 item 3) — a
 * full-screen counterpart to desktop's `RemoteTerminalDialog`. Lists any
 * persistent `pty-remote` sessions already running on the VM for this
 * workspace and lets the user "Reattach" or "Start new", then hands off to
 * the shared `RemoteTerminalPanel` (unchanged from desktop) plus a touch
 * control-sequence toolbar for Ctrl/Esc/arrow keys a software keyboard
 * doesn't supply.
 */
import { useEffect, useState } from "react";
import {
  remotePtyListPersistentSessions,
  type RemotePersistentPtySession,
} from "../../lib/api-extra";
import {
  RemoteTerminalPanel,
  type RemoteTerminalTarget,
} from "../RemoteTerminalPanel";
import { dispatchOverSsh } from "../../lib/remote-dispatch";
import type { SshEndpoint } from "../../lib/api-types-remote";
import type { Workspace } from "../../lib/api-types";
import { RemoteTerminalTouchToolbar } from "./RemoteTerminalTouchToolbar";

const DEFAULT_LABEL = "shell";

export function RemoteTerminalScreen({
  endpoint,
  repo,
  workspace,
}: {
  endpoint: SshEndpoint;
  repo: string;
  workspace: string;
}) {
  const [sessions, setSessions] = useState<RemotePersistentPtySession[] | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [target, setTarget] = useState<RemoteTerminalTarget | null>(null);
  // The workspace's own checkout directory on the VM, not the repo root -
  // falls back to `repo` only if the workspace can't be found (e.g. it was
  // removed between opening this screen and listing workspaces).
  const [remoteWorkingDirectory, setRemoteWorkingDirectory] = useState(repo);

  useEffect(() => {
    let cancelled = false;
    dispatchOverSsh<Workspace[]>(endpoint, { kind: "ListWorkspaces", repo })
      .then((workspaces) => {
        if (cancelled) return;
        const match = workspaces.find((ws) => ws.workspace_name === workspace);
        if (match) setRemoteWorkingDirectory(match.workspace_path);
      })
      .catch(() => {
        // Best-effort: keep the repo-root fallback already in state.
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint, repo, workspace]);

  useEffect(() => {
    let cancelled = false;
    remotePtyListPersistentSessions(endpoint, repo, workspace)
      .then((list) => {
        if (!cancelled) setSessions(list);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
          setSessions([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint, repo, workspace]);

  if (target) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-background">
        <RemoteTerminalPanel
          target={target}
          onClose={() => setTarget(null)}
          renderToolbar={(send) => <RemoteTerminalTouchToolbar onSend={send} />}
        />
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">Terminal</h2>
      {sessions === null && !loadError && (
        <p className="text-sm text-muted-foreground">
          Checking for running sessions…
        </p>
      )}
      {loadError && <p className="text-sm text-destructive">{loadError}</p>}
      {sessions && sessions.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-muted-foreground">
            Running sessions
          </p>
          {sessions.map((session) => (
            <div
              key={session.session_name}
              className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{session.label}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {session.running ? "running" : "stopped"}
                </p>
              </div>
              <button
                type="button"
                disabled={!session.running}
                className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
                onClick={() =>
                  setTarget({
                    endpoint,
                    repositoryId: repo,
                    workspaceId: workspace,
                    remoteWorkingDirectory,
                    label: session.label,
                    reattach: true,
                  })
                }
              >
                Reattach
              </button>
            </div>
          ))}
        </div>
      )}
      {sessions && (
        <button
          type="button"
          className="rounded-md border px-3 py-2 text-sm"
          onClick={() =>
            setTarget({
              endpoint,
              repositoryId: repo,
              workspaceId: workspace,
              remoteWorkingDirectory,
              label:
                sessions.length > 0
                  ? `${DEFAULT_LABEL}-${sessions.length + 1}`
                  : DEFAULT_LABEL,
              reattach: false,
            })
          }
        >
          Start new session
        </button>
      )}
    </section>
  );
}
