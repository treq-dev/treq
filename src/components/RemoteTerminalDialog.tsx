/**
 * Entry point for opening a remote PTY terminal against a connected
 * `SshEndpoint` (mobile remote PRD, Phase 8). Before rendering the actual
 * terminal (`RemoteTerminalPanel`), lists any persistent `pty-remote`
 * sessions already running on the VM for this workspace and lets the user
 * pick "Reattach" (pick up a running session, mirroring mobile's
 * `WorkspaceDetailScreen` "Reattach"/"Start new" choice) or "Start new"
 * (a fresh label).
 */
import { useEffect, useState } from "react";
import { Loader2, TerminalSquare } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Button } from "./ui/button";
import {
  remotePtyListPersistentSessions,
  type RemotePersistentPtySession,
} from "../lib/api-extra";
import {
  RemoteTerminalPanel,
  type RemoteTerminalTarget,
} from "./RemoteTerminalPanel";
import type { SshEndpoint } from "../lib/api-types-remote";

const DEFAULT_LABEL = "shell";

interface RemoteTerminalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  endpoint: SshEndpoint;
  repositoryId: string;
  workspaceId: string;
  remoteWorkingDirectory: string;
}

export const RemoteTerminalDialog = ({
  open,
  onOpenChange,
  endpoint,
  repositoryId,
  workspaceId,
  remoteWorkingDirectory,
}: RemoteTerminalDialogProps) => {
  const [sessions, setSessions] = useState<RemotePersistentPtySession[] | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [target, setTarget] = useState<RemoteTerminalTarget | null>(null);

  useEffect(() => {
    if (!open) return;
    setSessions(null);
    setLoadError(null);
    setTarget(null);
    let cancelled = false;
    remotePtyListPersistentSessions(endpoint, repositoryId, workspaceId)
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
  }, [open, endpoint, repositoryId, workspaceId]);

  if (!open) return null;

  // Once a target is chosen, hand off to the terminal itself full-screen
  // within the dialog frame.
  if (target) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl h-[70vh] p-0 flex flex-col overflow-hidden">
          <RemoteTerminalPanel
            target={target}
            onClose={() => onOpenChange(false)}
          />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TerminalSquare className="w-4 h-4" />
            Remote terminal
          </DialogTitle>
          <DialogDescription>
            Open an interactive shell on {endpoint.hostname}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 mt-2">
          {sessions === null && !loadError && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              Checking for running sessions…
            </div>
          )}

          {loadError && <p className="text-sm text-red-500">{loadError}</p>}

          {sessions && sessions.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Running sessions
              </p>
              {sessions.map((session) => (
                <div
                  key={session.session_name}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {session.label}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {session.running ? "running" : "stopped"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    disabled={!session.running}
                    onClick={() =>
                      setTarget({
                        endpoint,
                        repositoryId,
                        workspaceId,
                        remoteWorkingDirectory,
                        label: session.label,
                        reattach: true,
                      })
                    }
                  >
                    Reattach
                  </Button>
                </div>
              ))}
            </div>
          )}

          {sessions && (
            <Button
              variant={sessions.length > 0 ? "outline" : "default"}
              onClick={() =>
                setTarget({
                  endpoint,
                  repositoryId,
                  workspaceId,
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
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
