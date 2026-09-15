/**
 * Desktop PTY streaming/reattach UI (mobile remote PRD, Phase 8) — the
 * counterpart to mobile's `TerminalScreen.tsx`. Renders a real interactive
 * terminal against a typed `SshEndpoint` over `remote_pty_create`/
 * `remote_pty_reattach`, mirroring `ConsolidatedTerminal`'s xterm.js wiring
 * (fit addon, resize observer, key handling) but against the remote PTY IPC
 * surface (`remotePty*` in `lib/api-extra.ts`) instead of the local one.
 *
 * "Detach" only tears down this component's local xterm/listeners — the
 * VM-local `pty-remote` (tmux/screen) session keeps running and can be
 * reattached to later, same distinction mobile's `TerminalScreen` draws
 * between Detach and Stop. "Stop" additionally asks the VM to kill the
 * session via a `PtyStop` dispatch.
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
  remotePtyCreate,
  remotePtyListen,
  remotePtyListenExit,
  remotePtyReattach,
  remotePtyResize,
  remotePtyWrite,
} from "../lib/api-extra";
import { dispatchOverSsh } from "../lib/remote-dispatch";
import type { SshEndpoint } from "../lib/api-types-remote";

/** Exact command line `core::remote_pty::build_launch_command` builds for `PtyLaunchSpec::Shell`. */
const DEFAULT_SHELL_COMMAND = '"${SHELL:-/bin/bash}" -l';

export interface RemoteTerminalTarget {
  endpoint: SshEndpoint;
  repositoryId: string;
  workspaceId: string;
  remoteWorkingDirectory: string;
  /** Persistent `pty-remote` session label this panel attaches to / creates. */
  label: string;
  /** `true` reattaches to an existing VM-local session; `false` starts fresh. */
  reattach: boolean;
}

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
}

export const RemoteTerminalPanel = ({
  target,
  onClose,
  renderToolbar,
}: RemoteTerminalPanelProps) => {
  const { endpoint, repositoryId, workspaceId, remoteWorkingDirectory, label } =
    target;
  const [sessionId] = useState(
    () => `remote-pty-${endpoint.id}-${workspaceId}-${label}-${Date.now()}`,
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const isReadyRef = useRef(false);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exited, setExited] = useState<number | null | undefined>(undefined);
  const [isStopping, setIsStopping] = useState(false);

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
    fitAddonRef.current = fitAddon;

    const handleError = (err: unknown) => {
      if (cancelled) return;
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    };

    const dataSub = xterm.onData((data) => {
      if (!isReadyRef.current) return;
      remotePtyWrite(sessionId, data).catch(handleError);
    });

    let unlistenData: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;

    const cols = xterm.cols || 80;
    const rows = xterm.rows || 24;

    const setup = async () => {
      try {
        if (target.reattach) {
          await remotePtyReattach(
            sessionId,
            endpoint,
            repositoryId,
            workspaceId,
            label,
            remoteWorkingDirectory,
            DEFAULT_SHELL_COMMAND,
            cols,
            rows,
          );
        } else {
          await remotePtyCreate(
            sessionId,
            endpoint,
            repositoryId,
            workspaceId,
            remoteWorkingDirectory,
            { type: "shell" },
            cols,
            rows,
          );
        }
        if (cancelled) return;

        unlistenData = await remotePtyListen(sessionId, (chunk) => {
          xterm.write(chunk);
        });
        unlistenExit = await remotePtyListenExit(sessionId, (payload) => {
          setExited(payload.exit_status);
        });
        if (cancelled) {
          unlistenData?.();
          unlistenExit?.();
          return;
        }

        isReadyRef.current = true;
        setIsReady(true);

        requestAnimationFrame(() => {
          try {
            fitAddon.fit();
          } catch {
            /* container may not have a layout yet */
          }
        });
      } catch (err) {
        handleError(err);
      }
    };

    setup();

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
      fitAddonRef.current = null;
      isReadyRef.current = false;
      // Deliberately does NOT call remotePtyClose here: unmounting this
      // panel is "Detach" by default (leave the VM-local tmux/screen
      // session running). remotePtyClose only tears down this process's
      // SSH channel to it, which is what a plain component unmount should
      // do — the remote process itself is unaffected either way.
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
    try {
      await dispatchOverSsh(endpoint, {
        kind: "PtyStop",
        repo: repositoryId,
        workspace: workspaceId,
        label,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsStopping(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="h-8 flex items-center justify-between px-2 border-b border-border bg-background flex-shrink-0">
        <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground min-w-0">
          <TerminalSquare className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate">
            {endpoint.hostname} · {label}
          </span>
          {exited !== undefined && (
            <span className="text-xs text-amber-500">
              (session ended{exited != null ? `, exit ${exited}` : ""})
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
        {!isReady && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 text-sm text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mb-2" />
            <span>
              {target.reattach ? "Reattaching…" : "Starting remote shell…"}
            </span>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/90 text-sm px-4 text-center">
            <span className="text-red-500">{error}</span>
            <Button size="sm" variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        )}
      </div>
      {renderToolbar?.(send)}
    </div>
  );
};
