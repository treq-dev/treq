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
  ptyListen,
  ptyResize,
  ptySessionExists,
  ptyWrite,
  ptyWriteSuppressEcho,
} from "../lib/api";
import { consumePtyEcho } from "./terminal/consumePtyEcho";
import { useTerminalSettingsStore } from "../stores/terminalSettingsStore";
import { cn } from "../lib/utils";
import { Loader2 } from "lucide-react";
import { Button } from "./ui/button";

interface ConsolidatedTerminalProps {
  ref?: Ref<ConsolidatedTerminalHandle>;
  sessionId: string;
  workingDirectory?: string;
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
}

const normalizeCommand = (command: string) => {
  if (command.endsWith("\r\n") || command.endsWith("\n")) {
    return command;
  }
  return `${command}\r\n`;
};

export const ConsolidatedTerminal = ({
  sessionId,
  workingDirectory,
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
  const outputRef = useRef("");
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
    outputRef.current = "";
    pendingEchoRef.current = "";
    autoCommandSentRef.current = false;
    setTerminalError(null);
  }, [sessionId, instanceKey]);

  const handleRetryTerminal = () => {
    setTerminalError(null);
    setInstanceKey((prev) => prev + 1);
  };

  // Main terminal setup effect - all handlers are inlined to avoid stale closures
  useEffect(() => {
    if (!terminalRef.current) return;

    setIsPtyReady(false);
    isPtyReadyRef.current = false;

    // Local error handler
    const localHandleError = (error: unknown) => {
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
        webglAddon.onContextLoss(() => {
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
      outputRef.current += chunk;
      const consumed = consumePtyEcho(pendingEchoRef.current, chunk);
      pendingEchoRef.current = consumed.pendingEcho;
      const fromProcess = consumed.processOutput.length > 0;
      onTerminalOutputRef.current?.(outputRef.current, fromProcess);
      if (!fromProcess) return;
      if (idleTimeoutRef.current) clearTimeout(idleTimeoutRef.current);
      idleTimeoutRef.current = setTimeout(() => {
        onTerminalIdleRef.current?.();
      }, idleTimeoutMs);
    };

    xterm.attachCustomKeyEventHandler(localHandleKeyEvent);
    xterm.onData(localHandleXtermData);

    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (!blob) continue;

          const reader = new FileReader();
          reader.onload = () => {
            const [, base64] = (reader.result as string).split(",");
            // iTerm2 inline image protocol: OSC 1337 ; File=inline=1:BASE64 BEL
            const escapeSeq = `\x1b]1337;File=inline=1:${base64}\x07`;
            xterm.write(escapeSeq);
          };
          reader.readAsDataURL(blob);
          return; // Handle first image only
        }
      }
    };

    terminalRef.current?.addEventListener("paste", handlePaste);

    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;

    // Setup PTY
    const setupPty = async () => {
      try {
        const exists = await ptySessionExists(sessionId);
        const isNewSession = !exists;

        if (isNewSession) {
          await ptyCreateSession(
            sessionId,
            workingDirectory,
            shell,
            undefined,
            initialAutoCommandRef.current || undefined,
          );
        }

        const unlisten = await ptyListen(sessionId, localHandlePtyOutput);
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
          setTimeout(
            () => {
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
      if (resizeTimeout) clearTimeout(resizeTimeout);
      if (idleTimeoutRef.current) {
        clearTimeout(idleTimeoutRef.current);
        idleTimeoutRef.current = null;
      }

      terminalRef.current?.removeEventListener("paste", handlePaste);

      unlistenRef.current?.();
      unlistenRef.current = null;

      xterm.dispose();
      searchAddonRef.current = null;
      webglAddonRef.current?.dispose();
      webglAddonRef.current = null;
      webglContextLossDisposeRef.current?.dispose();
      webglContextLossDisposeRef.current = null;

      setIsPtyReady(false);
      isPtyReadyRef.current = false;
    };
  }, [
    sessionId,
    workingDirectory,
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
    requestAnimationFrame(() => {
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
    };
  }, [isHidden, sessionId]);

  useImperativeHandle(ref, () => ({
    findNext: (term: string, options?: ISearchOptions) => {
      if (!term || !searchAddonRef.current) return false;
      return searchAddonRef.current.findNext(term, options);
    },
    findPrevious: (term: string, options?: ISearchOptions) => {
      if (!term || !searchAddonRef.current) return false;
      return searchAddonRef.current.findPrevious(term, options);
    },
    clearSearch: () => {
      searchAddonRef.current?.clearDecorations();
    },
    focus: () => {
      xtermRef.current?.focus();
    },
    scrollToBottom: () => {
      xtermRef.current?.scrollToBottom();
    },
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
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(e) => {
            e.preventDefault();
            // Get file paths from the drop event
            const files = Array.from(e.dataTransfer.files);
            if (files.length > 0 && isPtyReadyRef.current) {
              // In Tauri/Electron, files have a 'path' property
              const paths = files
                .map((f: File & { path?: string }) => f.path)
                .filter(Boolean)
                .join(" ");
              if (paths) {
                ptyWrite(sessionId, paths).catch(console.error);
              }
            }
          }}
        />
        {!isPtyReady && !terminalError && !skipLoadingState && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 text-sm text-muted-foreground z-10">
            <Loader2 className="w-5 h-5 animate-spin mb-2" />
            <span>Preparing terminal...</span>
          </div>
        )}
        {terminalError && (
          <div className="absolute inset-0 bg-background/90 backdrop-blur-sm flex items-center justify-center z-20 p-6">
            <div className="w-full max-w-sm rounded-lg border bg-card p-4 text-center shadow-lg">
              <p className="text-sm font-semibold">Unable to start terminal</p>
              <p className="text-sm text-muted-foreground mt-2 break-words">
                {terminalError}
              </p>
              <div className="mt-4 flex flex-col gap-2">
                <Button size="sm" onClick={handleRetryTerminal}>
                  Try again
                </Button>
                {onClose && (
                  <Button size="sm" variant="outline" onClick={onClose}>
                    Close session
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

ConsolidatedTerminal.displayName = "ConsolidatedTerminal";
