import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import { type IDisposable, Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { LigaturesAddon } from "@xterm/addon-ligatures";
import { WebglAddon } from "@xterm/addon-webgl";
import { ISearchOptions, SearchAddon } from "@xterm/addon-search";
import { ImageAddon } from "@xterm/addon-image";
import {
  ptyCreateSession,
  ptyClose,
  ptyListen,
  ptyResize,
  ptySessionExists,
  ptyWrite,
  ptyWriteSuppressEcho,
} from "../lib/api";
import { consumePtyEcho } from "./terminal/consumePtyEcho";
import { readXtermScreen } from "./terminal/readXtermScreen";
import { useTerminalSettingsStore } from "../stores/terminalSettingsStore";
import { cn } from "../lib/utils";
import { Loader2 } from "lucide-react";
import { TerminalErrorOverlay } from "./terminal/TerminalErrorOverlay";
import { normalizeCommand } from "./terminal/normalizeCommand";
import {
  handleTerminalDragOver,
  handleTerminalDrop,
  handleTerminalPaste,
} from "./terminal/handleTerminalClipboard";

interface ConsolidatedTerminalProps {
  ref?: Ref<ConsolidatedTerminalHandle>;
  sessionId: string;
  workingDirectory?: string;
  repoPath?: string;
  workspaceId?: number | null;
  remoteHost?: string;
  shell?: string;
  autoCommand?: string;
  onSessionError?: (message: string) => void;
  onTerminalOutput?: (output: string, fromProcess?: boolean) => void;
  onTerminalInput?: () => void;
  onTerminalIdle?: () => void;
  onClose?: () => void;
  idleTimeoutMs?: number;
  containerClassName?: string;
  terminalPaneClassName?: string;
  terminalBackgroundClassName?: string;
  isHidden?: boolean;
  /** Skip loading state - useful for split terminals where seamless appearance is preferred */
  skipLoadingState?: boolean;
}

export interface ConsolidatedTerminalHandle {
  findNext: (term: string, options?: ISearchOptions) => boolean;
  findPrevious: (term: string, options?: ISearchOptions) => boolean;
  clearSearch: () => void;
  focus: () => void;
  scrollToBottom: () => void;
  getScreenText: () => string;
}

export const ConsolidatedTerminal = ({
  sessionId,
  workingDirectory,
  repoPath,
  workspaceId,
  remoteHost,
  shell,
  autoCommand,
  onSessionError,
  onTerminalOutput,
  onTerminalInput,
  onTerminalIdle,
  onClose,
  idleTimeoutMs = 2000,
  containerClassName,
  terminalPaneClassName,
  terminalBackgroundClassName,
  isHidden = false,
  skipLoadingState = false,
  ref,
}: ConsolidatedTerminalProps) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const webglAddonRef = useRef<WebglAddon | null>(null);
  const webglContextLossDisposeRef = useRef<IDisposable | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);
  const pendingEchoRef = useRef("");
  const idleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isPtyReady, setIsPtyReady] = useState(false);
  const isPtyReadyRef = useRef(isPtyReady);
  const lastValidDimensionsRef = useRef<{
    rows: number;
    cols: number;
  } | null>(null);
  const autoCommandSentRef = useRef(false);
  const initialAutoCommandRef = useRef(autoCommand);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [instanceKey, setInstanceKey] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);

  const onSessionErrorRef = useRef(onSessionError);
  const onTerminalOutputRef = useRef(onTerminalOutput);
  const onTerminalInputRef = useRef(onTerminalInput);
  const onTerminalIdleRef = useRef(onTerminalIdle);
  const fontSize = useTerminalSettingsStore((s) => s.fontSize);

  useEffect(() => {
    isPtyReadyRef.current = isPtyReady;
    onSessionErrorRef.current = onSessionError;
    onTerminalOutputRef.current = onTerminalOutput;
    onTerminalInputRef.current = onTerminalInput;
    onTerminalIdleRef.current = onTerminalIdle;
  }, [
    isPtyReady,
    onSessionError,
    onTerminalOutput,
    onTerminalInput,
    onTerminalIdle,
  ]);

  // Reset output and error when session changes
  useEffect(() => {
    pendingEchoRef.current = "";
    autoCommandSentRef.current = false;
    setTerminalError(null);
  }, [sessionId, instanceKey]);

  const handleRetryTerminal = async () => {
    if (isRetrying) return;
    setIsRetrying(true);
    try {
      await ptyClose(sessionId);
      setTerminalError(null);
      setInstanceKey((prev) => prev + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTerminalError(message);
      onSessionErrorRef.current?.(message);
    } finally {
      setIsRetrying(false);
    }
  };

  useEffect(() => {
    if (!terminalRef.current) return;
    let cancelled = false;

    setIsPtyReady(false);
    isPtyReadyRef.current = false;

    // Local error handler
    const localHandleError = (error: unknown) => {
      if (cancelled) return;
      const message = error instanceof Error ? error.message : String(error);
      console.error("Terminal error:", message);
      const friendlyMessage = message.includes("Session not found")
        ? "Terminal session is still initializing. Please wait a moment and try again."
        : message;
      setTerminalError(friendlyMessage);
      onSessionErrorRef.current?.(friendlyMessage);
    };

    const xterm = new XTerm({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize,
      fontFamily:
        '"JetBrains Mono", "JetBrains Mono Fallback", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      theme: { background: "#1e1e1e" },
      scrollback: 5000,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();

    // Load addons before opening
    xterm.loadAddon(fitAddon);
    xterm.loadAddon(new WebLinksAddon());
    xterm.loadAddon(new Unicode11Addon());
    xterm.loadAddon(searchAddon);
    xterm.unicode.activeVersion = "11";

    searchAddonRef.current = searchAddon;

    // Open terminal in DOM
    xterm.open(terminalRef.current);

    // Load LigaturesAddon after opening (requires DOM)
    xterm.loadAddon(new LigaturesAddon());

    // Load ImageAddon for inline image rendering
    xterm.loadAddon(new ImageAddon());

    // Load WebGL addon
    if (
      typeof window !== "undefined" &&
      "WebGLRenderingContext" in window &&
      xterm.element
    ) {
      try {
        const webglAddon = new WebglAddon();
        webglContextLossDisposeRef.current = webglAddon.onContextLoss(() => {
          console.warn("WebGL context lost; reverting to canvas renderer");
          webglAddonRef.current?.dispose();
          webglAddonRef.current = null;
          webglContextLossDisposeRef.current?.dispose();
          webglContextLossDisposeRef.current = null;
        });
        xterm.loadAddon(webglAddon);
        webglAddonRef.current = webglAddon;
      } catch (error) {
        console.warn("Failed to enable WebGL renderer", error);
        webglAddonRef.current?.dispose();
        webglAddonRef.current = null;
      }
    }

    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;

    // Local resize handler
    const localHandleResize = () => {
      const terminal = terminalRef.current;
      if (!terminal || !xterm || !fitAddon) return;

      const rect = terminal.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      if (!("buffer" in xterm)) return;

      try {
        fitAddon.fit();
        const { rows, cols } = xterm;
        lastValidDimensionsRef.current = { rows, cols };

        if (isPtyReadyRef.current) {
          ptyResize(sessionId, rows, cols).catch(localHandleError);
        }
      } catch (error) {
        console.warn("Resize failed", error);
      }
    };

    const localHandleKeyEvent = (event: KeyboardEvent): boolean => {
      // Allow global shortcuts to propagate (don't let XTerm consume them)
      // Note: Escape is NOT included - it should always go to the terminal
      // for things like canceling Claude operations, exiting vim modes, etc.
      const isGlobalShortcut =
        (event.metaKey || event.ctrlKey) &&
        ["k", "j", "n", "p"].includes(event.key.toLowerCase());

      if (isGlobalShortcut) {
        // Dispatch to window so global handlers can receive it
        // (xterm captures events and they don't bubble to window naturally)
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: event.key,
            code: event.code,
            metaKey: event.metaKey,
            ctrlKey: event.ctrlKey,
            shiftKey: event.shiftKey,
            altKey: event.altKey,
            bubbles: true,
          }),
        );
        return false; // Let event propagate to window listeners
      }

      const activeElement = document.activeElement as HTMLElement | null;
      const isWithinXterm = activeElement?.closest(".xterm") !== null;
      const isInputFocused =
        !isWithinXterm &&
        (activeElement?.tagName === "INPUT" ||
          activeElement?.tagName === "TEXTAREA" ||
          activeElement?.getAttribute("contenteditable") === "true");

      if (isInputFocused) {
        return false;
      }

      // Handle Shift+Enter for line continuation
      if (event.key === "Enter" && event.shiftKey && event.type === "keydown") {
        if (isPtyReadyRef.current) {
          ptyWrite(sessionId, "\\").catch(localHandleError);
        }
        return false;
      }

      return true;
    };

    const localHandleXtermData = (data: string) => {
      if (!isPtyReadyRef.current) return;
      pendingEchoRef.current += data;
      onTerminalInputRef.current?.();
      ptyWrite(sessionId, data).catch(localHandleError);
    };

    const localHandlePtyOutput = (chunk: string) => {
      xterm.write(chunk);
      const consumed = consumePtyEcho(pendingEchoRef.current, chunk);
      pendingEchoRef.current = consumed.pendingEcho;
      const fromProcess = consumed.processOutput.length > 0;
      onTerminalOutputRef.current?.(chunk, fromProcess);
      if (!fromProcess) return;
      if (idleTimeoutRef.current) clearTimeout(idleTimeoutRef.current);
      idleTimeoutRef.current = setTimeout(() => {
        onTerminalIdleRef.current?.();
      }, idleTimeoutMs);
    };

    xterm.attachCustomKeyEventHandler(localHandleKeyEvent);
    const xtermDataSubscription = xterm.onData(localHandleXtermData);

    const handlePaste = (e: ClipboardEvent) => {
      handleTerminalPaste(e, {
        isPtyReady: isPtyReadyRef.current,
        write: (text) => {
          ptyWrite(sessionId, text).catch(console.error);
        },
        writeInlineImage: (escapeSeq) => {
          xterm.write(escapeSeq);
        },
      });
    };

    terminalRef.current?.addEventListener("paste", handlePaste);

    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
    let autoCommandTimeout: ReturnType<typeof setTimeout> | null = null;
    let localUnlisten: (() => void) | null = null;

    // Setup PTY
    const setupPty = async () => {
      try {
        const exists = await ptySessionExists(sessionId);
        if (cancelled) return;
        const isNewSession = !exists;

        if (isNewSession) {
          await ptyCreateSession(
            sessionId,
            workingDirectory,
            shell,
            undefined,
            initialAutoCommandRef.current || undefined,
            remoteHost,
            repoPath,
            workspaceId,
          );
          if (cancelled) return;
        }

        const unlisten = await ptyListen(sessionId, localHandlePtyOutput);
        if (cancelled) {
          unlisten();
          return;
        }
        localUnlisten = unlisten;
        unlistenRef.current = unlisten;
        setIsPtyReady(true);
        isPtyReadyRef.current = true;

        resizeTimeout = setTimeout(localHandleResize, 100);

        // Send autoCommand if we have one and haven't sent it yet
        // (isNewSession check ensures we only send on first setup, ref prevents duplicates)
        // Use initialAutoCommandRef to avoid re-running effect when autoCommand prop changes
        if (
          initialAutoCommandRef.current &&
          !autoCommandSentRef.current &&
          isNewSession
        ) {
          autoCommandSentRef.current = true;
          // Add a small delay to ensure the shell prompt is ready
          autoCommandTimeout = setTimeout(
            () => {
              if (cancelled) return;
              ptyWriteSuppressEcho(
                sessionId,
                normalizeCommand(initialAutoCommandRef.current!),
              ).catch(localHandleError);
            },
            isNewSession ? 100 : 0,
          );
        }
      } catch (error) {
        localHandleError(error);
      }
    };

    setupPty();

    return () => {
      cancelled = true;
      if (resizeTimeout) clearTimeout(resizeTimeout);
      if (autoCommandTimeout) clearTimeout(autoCommandTimeout);
      if (idleTimeoutRef.current) {
        clearTimeout(idleTimeoutRef.current);
        idleTimeoutRef.current = null;
      }

      terminalRef.current?.removeEventListener("paste", handlePaste);

      localUnlisten?.();
      if (unlistenRef.current === localUnlisten) unlistenRef.current = null;

      xtermDataSubscription.dispose();
      webglContextLossDisposeRef.current?.dispose();
      webglContextLossDisposeRef.current = null;
      webglAddonRef.current?.dispose();
      webglAddonRef.current = null;
      xterm.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;

      setIsPtyReady(false);
      isPtyReadyRef.current = false;
    };
  }, [
    sessionId,
    workingDirectory,
    repoPath,
    workspaceId,
    remoteHost,
    shell,
    fontSize,
    instanceKey,
    idleTimeoutMs,
  ]);

  // Separate effect to handle resize observer based on visibility
  useEffect(() => {
    if (!terminalRef.current || !xtermRef.current || !fitAddonRef.current)
      return;

    const xterm = xtermRef.current;
    const fitAddon = fitAddonRef.current;
    const terminal = terminalRef.current;

    const handleResize = () => {
      if (!terminal || !xterm || !fitAddon) return;

      const rect = terminal.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      if (!("buffer" in xterm)) return;

      try {
        fitAddon.fit();
        const { rows, cols } = xterm;
        lastValidDimensionsRef.current = { rows, cols };

        if (isPtyReadyRef.current) {
          ptyResize(sessionId, rows, cols).catch((error) => {
            console.error("Resize error:", error);
          });
        }
      } catch (error) {
        console.warn("Resize failed", error);
      }
    };

    if (isHidden) {
      // Clean up resize observers when hidden
      window.removeEventListener("resize", handleResize);
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      return;
    }

    // Set up resize observers when visible
    window.addEventListener("resize", handleResize);
    resizeObserverRef.current = new ResizeObserver(handleResize);
    resizeObserverRef.current.observe(terminal);

    // Initial fit when becoming visible
    const initialFitFrame = requestAnimationFrame(() => {
      if (!terminal) return;
      const rect = terminal.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      try {
        fitAddon.fit();
      } catch (error) {
        console.warn("Initial fit failed", error);
      }
    });

    return () => {
      window.removeEventListener("resize", handleResize);
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      cancelAnimationFrame(initialFitFrame);
    };
  }, [isHidden, sessionId]);

  useImperativeHandle(ref, () => ({
    findNext: (term, options) =>
      !!term && !!searchAddonRef.current?.findNext(term, options),
    findPrevious: (term, options) =>
      !!term && !!searchAddonRef.current?.findPrevious(term, options),
    clearSearch: () => searchAddonRef.current?.clearDecorations(),
    focus: () => xtermRef.current?.focus(),
    scrollToBottom: () => xtermRef.current?.scrollToBottom(),
    getScreenText: () => readXtermScreen(xtermRef.current),
  }));

  return (
    <div
      className={cn(
        "flex-1 flex overflow-hidden w-full h-full",
        containerClassName,
      )}
    >
      <div
        className={cn(
          "min-w-0 relative w-2/5",
          terminalBackgroundClassName,
          terminalPaneClassName,
        )}
      >
        <div
          ref={terminalRef}
          className={cn(
            "h-full w-full pt-1",
            "[&_.xterm-viewport::-webkit-scrollbar]:w-2",
            "[&_.xterm-viewport::-webkit-scrollbar-track]:bg-transparent",
            "[&_.xterm-viewport::-webkit-scrollbar-thumb]:bg-border",
            "[&_.xterm-viewport::-webkit-scrollbar-thumb]:rounded",
          )}
          onDragOver={handleTerminalDragOver}
          onDrop={(e) => {
            handleTerminalDrop(e, {
              isPtyReady: isPtyReadyRef.current,
              write: (text) => {
                ptyWrite(sessionId, text).catch(console.error);
              },
            });
          }}
        />
        {!isPtyReady && !terminalError && !skipLoadingState && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 text-sm text-muted-foreground z-10">
            <Loader2 className="w-5 h-5 animate-spin mb-2" />
            <span>Preparing terminal...</span>
          </div>
        )}
        {terminalError && (
          <TerminalErrorOverlay
            error={terminalError}
            isRetrying={isRetrying}
            onRetry={handleRetryTerminal}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
};
