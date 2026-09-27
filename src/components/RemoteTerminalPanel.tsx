/**
 * Interactive terminal for a remote workspace, rendered in desktop's
 * terminal pane and in mobile's `TerminalScreen`. Mirrors
 * `ConsolidatedTerminal`'s xterm.js wiring (fit addon, resize observer) but
 * talks to the remote PTY IPC surface (`remotePty*` in `lib/api-extra.ts`)
 * instead of the local one.
 *
 * Every session runs inside the VM-local `pty-remote` supervisor
 * (tmux/screen), opened with `remote_pty_reattach`, which attaches to the
 * named session or creates it first. So a shell or agent started here keeps
 * running when the panel closes or the connection drops, and it can be
 * reattached by its label later.
 *
 * "Detach" only tears down this component's xterm, listeners and SSH
 * channel. "Stop" additionally asks the VM to kill the session via a
 * `PtyStop` dispatch.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Loader2, TerminalSquare, X } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import {
  remotePtyClose,
  remotePtyListen,
  remotePtyListenExit,
  remotePtyListPersistentSessions,
  remotePtyReattach,
  remotePtyResize,
  remotePtyWrite,
} from "../lib/api-extra";
import { dispatchOverSsh } from "../lib/remote-dispatch";
import type { SshEndpoint, PtyLaunchSpec } from "../lib/api-types-remote";

const SHELL_LAUNCH: PtyLaunchSpec = { type: "shell" };

/**
 * Minimum time between automatic reattach attempts. One automatic retry
 * covers a brief network drop; a session that keeps dropping straight away
 * waits for the user instead of looping.
 */
const AUTO_REATTACH_COOLDOWN_MS = 30_000;

export interface RemoteTerminalTarget {
  endpoint: SshEndpoint;
  repositoryId: string;
  workspaceId: string;
  remoteWorkingDirectory: string;
  /** Persistent `pty-remote` session label this panel attaches to / creates. */
  label: string;
  /**
   * What to run when the session does not exist yet. Ignored when a session
   * with this label is already running (the panel attaches to it instead).
   * Defaults to the user's login shell.
   */
  launch?: PtyLaunchSpec;
  /** `true` when picking up a session that is already running. Only changes the loading text. */
  reattach: boolean;
}

/**
 * How the attached SSH channel ended:
 * - `ended`: the persistent session is gone (the shell or agent exited, or it was stopped).
 * - `detached`: the channel closed but the session is still running, or its
 *   state could not be checked because the host is unreachable.
 */
type EndState =
  | { kind: "ended"; exitStatus: number | null }
  | {
      kind: "detached";
    };

interface RemoteTerminalPanelProps {
  target: RemoteTerminalTarget;
  onClose: () => void;
  /**
   * Optional extra chrome rendered below the terminal, given a `send`
   * function that writes raw bytes to the remote PTY. Used by mobile's
   * `RemoteTerminalScreen` to host a touch control-sequence toolbar
   * (Ctrl/Esc/arrows) without duplicating the session-write wiring.
   */
  renderToolbar?: (send: (data: string) => void) => ReactNode;
  /** Called with each output chunk, for activity tracking in the terminal pane. */
  onOutput?: (data: string) => void;
  /** Called when the user types into the terminal. */
  onInput?: () => void;
}

const makeSessionId = (target: RemoteTerminalTarget) =>
  `remote-pty-${target.endpoint.id}-${target.workspaceId}-${target.label}-${Date.now()}`;

export const RemoteTerminalPanel = ({
  target,
  onClose,
  renderToolbar,
  onOutput,
  onInput,
}: RemoteTerminalPanelProps) => {
  const { endpoint, repositoryId, workspaceId, remoteWorkingDirectory, label } =
    target;
  const launch = target.launch ?? SHELL_LAUNCH;
  // Each attach uses a fresh local session id: the backend refuses to reuse
  // an id, and the persistent label, not this id, identifies the session.
  const [sessionId, setSessionId] = useState(() => makeSessionId(target));
  const [attachCount, setAttachCount] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const isReadyRef = useRef(false);
  const stoppingRef = useRef(false);
  const lastAutoReattachRef = useRef<number | null>(null);
  const onOutputRef = useRef(onOutput);
  const onInputRef = useRef(onInput);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [endState, setEndState] = useState<EndState | null>(null);
  const [isStopping, setIsStopping] = useState(false);

  const reattach = () => {
    setError(null);
    setEndState(null);
    setIsReady(false);
    setAttachCount((count) => count + 1);
    setSessionId(makeSessionId(target));
  };
  const reattachRef = useRef(reattach);

  useEffect(() => {
    onOutputRef.current = onOutput;
    onInputRef.current = onInput;
    reattachRef.current = reattach;
  });

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    const xterm = new XTerm({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 13,
      fontFamily:
        '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      theme: { background: "#1e1e1e" },
      scrollback: 5000,
      allowProposedApi: true,
    });
    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.loadAddon(new WebLinksAddon());
    xterm.open(containerRef.current);
    xtermRef.current = xterm;

    const handleError = (err: unknown) => {
      if (cancelled) return;
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    };

    const dataSub = xterm.onData((data) => {
      if (!isReadyRef.current) return;
      onInputRef.current?.();
      remotePtyWrite(sessionId, data).catch(handleError);
    });

    let unlistenData: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;

    // Decides what an ended channel means. The persistent session outlives
    // the channel, so a closed channel alone does not say whether the shell
    // exited or the network dropped: ask the VM whether the session is
    // still there.
    const handleChannelExit = async (exitStatus: number | null) => {
      isReadyRef.current = false;
      if (cancelled || stoppingRef.current) return;
      let stillRunning: boolean | null;
      try {
        const sessions = await remotePtyListPersistentSessions(
          endpoint,
          repositoryId,
          workspaceId,
        );
        stillRunning = sessions.some((s) => s.label === label && s.running);
      } catch {
        stillRunning = null;
      }
      if (cancelled || stoppingRef.current) return;
      if (stillRunning === false) {
        setEndState({ kind: "ended", exitStatus });
        return;
      }
      const now = Date.now();
      const last = lastAutoReattachRef.current;
      if (
        stillRunning &&
        (last === null || now - last > AUTO_REATTACH_COOLDOWN_MS)
      ) {
        lastAutoReattachRef.current = now;
        reattachRef.current();
        return;
      }
      setEndState({ kind: "detached" });
    };

    const cols = xterm.cols || 80;
    const rows = xterm.rows || 24;

    const setup = async () => {
      try {
        // Subscribe before attaching so the first screen redraw from the
        // remote side is not emitted before anything is listening.
        unlistenData = await remotePtyListen(sessionId, (chunk) => {
          xterm.write(chunk);
          onOutputRef.current?.(chunk);
        });
        unlistenExit = await remotePtyListenExit(sessionId, (payload) => {
          void handleChannelExit(payload.exit_status);
        });
        if (cancelled) return;

        await remotePtyReattach(
          sessionId,
          endpoint,
          repositoryId,
          workspaceId,
          label,
          remoteWorkingDirectory,
          launch,
          cols,
          rows,
        );
        if (cancelled) return;

        isReadyRef.current = true;
        setIsReady(true);

        requestAnimationFrame(() => {
          try {
            fitAddon.fit();
            remotePtyResize(sessionId, xterm.cols, xterm.rows).catch(() => {
              /* the channel may already be gone */
            });
          } catch {
            /* container may not have a layout yet */
          }
        });
      } catch (err) {
        handleError(err);
      }
    };

    void setup();

    const handleResize = () => {
      if (!containerRef.current || !isReadyRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      try {
        fitAddon.fit();
        remotePtyResize(sessionId, xterm.cols, xterm.rows).catch(handleError);
      } catch {
        /* ignore transient fit failures during teardown */
      }
    };
    const resizeObserver = new ResizeObserver(handleResize);
    if (containerRef.current) resizeObserver.observe(containerRef.current);

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      dataSub.dispose();
      unlistenData?.();
      unlistenExit?.();
      xterm.dispose();
      xtermRef.current = null;
      isReadyRef.current = false;
      // Unmounting is "Detach": close this process's SSH channel only. The
      // VM-local tmux/screen session keeps running and can be reattached.
      remotePtyClose(sessionId).catch(() => {
        /* best-effort; the SSH connection may already be gone */
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const send = (data: string) => {
    if (!isReadyRef.current) return;
    remotePtyWrite(sessionId, data).catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
    });
    xtermRef.current?.focus();
  };

  const handleStop = async () => {
    setIsStopping(true);
    stoppingRef.current = true;
    try {
      await dispatchOverSsh(endpoint, {
        kind: "PtyStop",
        repo: repositoryId,
        workspace: workspaceId,
        label,
      });
      onClose();
    } catch (err) {
      stoppingRef.current = false;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsStopping(false);
    }
  };

  const isReattaching = target.reattach || attachCount > 0;

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="h-8 flex items-center justify-between px-2 border-b border-border bg-background flex-shrink-0">
        <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground min-w-0">
          <TerminalSquare className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate">
            {endpoint.hostname} · {label}
          </span>
          {endState?.kind === "ended" && (
            <span className="text-xs text-amber-500">
              (session ended
              {endState.exitStatus != null
                ? `, exit ${endState.exitStatus}`
                : ""}
              )
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            disabled={isStopping}
            onClick={() => void handleStop()}
          >
            Stop
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            aria-label="Detach"
            title="Detach (the session keeps running)"
            onClick={onClose}
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
      <div
        className="relative flex-1 min-h-0"
        style={{ backgroundColor: "#1e1e1e" }}
      >
        <div ref={containerRef} className={cn("h-full w-full pt-1")} />
        {!isReady && !error && !endState && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 text-sm text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mb-2" />
            <span>
              {isReattaching ? "Reattaching…" : "Starting remote session…"}
            </span>
          </div>
        )}
        {(error || endState?.kind === "detached") && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/90 text-sm px-4 text-center">
            <span className={error ? "text-red-500" : "text-foreground"}>
              {error ??
                "Connection to the remote session was lost. The session may still be running on the host."}
            </span>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={reattach}>
                Reattach
              </Button>
              <Button size="sm" variant="outline" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        )}
      </div>
      {renderToolbar?.(send)}
    </div>
  );
};
