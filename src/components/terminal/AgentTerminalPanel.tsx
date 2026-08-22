import { ArrowDownToLine, Loader2, RotateCw, Search, X } from "lucide-react";
import React, {
  type KeyboardEvent as ReactKeyboardEvent,
  useRef,
  useState,
} from "react";
import { useAgentMessageQueue } from "../../hooks/useAgentMessageQueue";
import { ptyClose, setSessionModel } from "../../lib/api";
import { looksLikeAgentUserQuestion } from "../../lib/agentMessageQueue";
import { cn } from "../../lib/utils";
import {
  ConsolidatedTerminal,
  type ConsolidatedTerminalHandle,
} from "../ConsolidatedTerminal";
import { AgentIcon } from "../icons/AgentIcons";
import { ModelSelector } from "../ModelSelector";
import { Button } from "../ui/button";
import { Kbd, KbdGroup } from "../ui/kbd";
import { useToast } from "../ui/toast";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { AgentMessageQueue } from "./AgentMessageQueue";
import { TerminalSearchOverlay } from "./TerminalSearchOverlay";
import { TerminalSendPreviews } from "./TerminalSendPreviews";
import type { ClaudeSessionData } from "./types";
import { useAgentAutoCommand } from "./useAgentAutoCommand";

export interface AgentTerminalPanelProps {
  sessionData: ClaudeSessionData;
  collapsed: boolean;
  isActive?: boolean;
  onFocus?: () => void;
  onDoubleClick?: () => void;
  onClose?: () => void;
  onSessionError?: (message: string) => void;
  onTerminalOutput?: (output: string, fromProcess?: boolean) => void;
  onTerminalInput?: () => void;
  onTerminalIdle?: () => void;
  terminalRefs: React.MutableRefObject<
    Map<string, ConsolidatedTerminalHandle | null>
  >;
  width?: number | null;
}

export const AgentTerminalPanel = ({
  sessionData,
  collapsed,
  isActive,
  onFocus,
  onDoubleClick,
  onClose,
  onSessionError,
  onTerminalOutput,
  onTerminalInput,
  onTerminalIdle,
  terminalRefs,
  width,
}: AgentTerminalPanelProps) => {
  const { addToast } = useToast();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isResetting, setIsResetting] = useState(false);
  const [isChangingModel, setIsChangingModel] = useState(false);
  const [terminalInstanceKey, setTerminalInstanceKey] = useState(0);
  const {
    sessionModel,
    setSessionModelState,
    isModelLoaded,
    autoCommand,
    prepareError,
  } = useAgentAutoCommand(sessionData);

  const terminalId = `claude-${sessionData.sessionId}`;
  const isHidden = collapsed;

  const [queuePopoverOpen, setQueuePopoverOpen] = useState(false);
  const [terminalBodyEl, setTerminalBodyEl] = useState<HTMLDivElement | null>(
    null,
  );
  const lastProcessOutputRef = useRef("");

  const {
    messages: queuedMessages,
    enqueue: enqueueMessage,
    remove: removeQueuedMessage,
    update: updateQueuedMessage,
    markBusy,
    markIdle,
    clear: clearQueuedMessages,
  } = useAgentMessageQueue({ ptySessionId: sessionData.ptySessionId });

  const handleEnqueueMessage = (text: string) => {
    enqueueMessage(text);
    setQueuePopoverOpen(true);
  };

  // Handle terminal output — agent is busy while streaming process output.
  const handleTerminalOutput = (output: string, fromProcess?: boolean) => {
    if (fromProcess !== false) {
      lastProcessOutputRef.current = output;
      markBusy();
    }
    onTerminalOutput?.(output, fromProcess);
  };

  const handleTerminalIdle = () => {
    markIdle({
      awaitingQuestion: looksLikeAgentUserQuestion(
        lastProcessOutputRef.current,
      ),
    });
    onTerminalIdle?.();
  };

  // Search handlers
  const openSearchPanel = () => {
    setSearchVisible(true);
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  };

  const closeSearchPanel = () => {
    setSearchVisible(false);
    setSearchQuery("");
    terminalRefs.current.get(terminalId)?.clearSearch();
  };

  const runSearch = (direction: "next" | "previous") => {
    if (!searchQuery.trim()) return;
    const terminal = terminalRefs.current.get(terminalId);
    if (!terminal) return;
    if (direction === "next") {
      terminal.findNext(searchQuery);
    } else {
      terminal.findPrevious(searchQuery);
    }
  };

  const handleSearchKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        runSearch("previous");
      } else {
        runSearch("next");
      }
    } else if (e.key === "Escape") {
      closeSearchPanel();
    }
  };

  // Reset handler - silent option used when reset is triggered by model change
  const handleReset = async (options?: { silent?: boolean }) => {
    setIsResetting(true);
    try {
      clearQueuedMessages();
      lastProcessOutputRef.current = "";
      markBusy();
      await ptyClose(sessionData.ptySessionId).catch(console.error);
      setTerminalInstanceKey((prev) => prev + 1);
      if (!options?.silent) {
        addToast({
          title: "Terminal Reset",
          description: `Starting new ${sessionData.agent === "codex" ? "Codex" : sessionData.agent === "cursor" ? "Cursor" : "Claude"} session`,
          type: "info",
        });
      }
    } catch (error) {
      addToast({
        title: "Reset Failed",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setIsResetting(false);
    }
  };

  // Model change handler
  const handleModelChange = async (newModel: string) => {
    setIsChangingModel(true);
    try {
      const modelToSave = newModel === "default" ? null : newModel;
      await setSessionModel(
        sessionData.repoPath,
        sessionData.sessionId,
        modelToSave,
      );
      setSessionModelState(modelToSave);
      await handleReset({ silent: true });
      addToast({
        title: "Terminal Restarting",
        description: `Using model: ${modelToSave || "default"}`,
        type: "info",
      });
      setIsChangingModel(false);
    } catch (error) {
      addToast({
        title: "Failed to change model",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
      setIsChangingModel(false);
    }
  };

  return (
    <div
      data-terminal-id={terminalId}
      className={cn(
        "flex flex-col min-h-0 overflow-hidden flex-shrink-0",
        width == null && "flex-1",
      )}
      style={{
        width: width != null ? width : undefined,
      }}
      onMouseDown={onFocus}
    >
      {/* Header */}
      <div
        className={cn(
          "h-7 min-h-[28px] flex items-center justify-between px-2 border-b border-r border-border flex-shrink-0",
          isActive ? "bg-primary/40" : "bg-gray-700",
        )}
        onDoubleClick={onDoubleClick}
      >
        <div className="flex items-center gap-1 text-sm font-medium text-gray-200">
          <AgentIcon agent={sessionData.agent} className="w-4 h-4" />
          <span className="truncate">{sessionData.sessionName}</span>
        </div>
        <div className="flex items-center gap-1">
          <AgentMessageQueue
            messages={queuedMessages}
            onEnqueue={handleEnqueueMessage}
            onRemove={removeQueuedMessage}
            onUpdate={updateQueuedMessage}
            open={queuePopoverOpen}
            onOpenChange={setQueuePopoverOpen}
            overlayContainer={terminalBodyEl}
          />
          {/* Model selector — Claude only */}
          {sessionData.agent !== "codex" && sessionData.agent !== "cursor" && (
            <ModelSelector
              currentModel={sessionModel}
              onModelChange={handleModelChange}
              disabled={isChangingModel || isResetting}
            />
          )}
          {/* Scroll to bottom */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  onClick={() =>
                    terminalRefs.current.get(terminalId)?.scrollToBottom()
                  }
                  variant="ghost"
                  size="xs"
                  className="bg-transparent text-gray-200 hover:bg-muted/20 hover:text-gray-200"
                  aria-label="Scroll to bottom"
                >
                  <ArrowDownToLine className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Scroll to bottom</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {/* Reset button */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={() => handleReset()}
                  disabled={isResetting}
                  variant="ghost"
                  size="xs"
                  className="bg-transparent text-gray-200 hover:bg-muted/20 hover:text-gray-200"
                  aria-label="Reset terminal"
                >
                  {isResetting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RotateCw className="w-4 h-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reset</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {/* Search button */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  onClick={openSearchPanel}
                  variant="ghost"
                  className="bg-transparent text-gray-200 hover:bg-muted/20 hover:text-gray-200"
                  size="xs"
                  aria-label="Search"
                >
                  <Search className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Search (⌘+F)</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {/* Close button */}
          {onClose && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    onClick={onClose}
                    variant="ghost"
                    size="xs"
                    className="bg-transparent text-gray-200 hover:bg-muted/20 hover:text-gray-200"
                    aria-label="Close session"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="flex items-center gap-1.5">
                  Close
                  <KbdGroup>
                    <Kbd>⌘ + W</Kbd>
                  </KbdGroup>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>

      <div
        ref={setTerminalBodyEl}
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden border-r border-border"
        style={{ backgroundColor: "#1e1e1e" }}
      >
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {searchVisible && !collapsed && (
            <TerminalSearchOverlay
              searchInputRef={searchInputRef}
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              onSearchKeyDown={handleSearchKeyDown}
              onFindPrevious={() => runSearch("previous")}
              onFindNext={() => runSearch("next")}
              onClose={closeSearchPanel}
            />
          )}

          {prepareError ? (
            <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
              Failed to start agent: {prepareError}
            </div>
          ) : isModelLoaded && autoCommand ? (
            <>
              <TerminalSendPreviews
                ptySessionId={sessionData.ptySessionId}
                isActive={!!isActive}
                onSendReview={handleEnqueueMessage}
              />
              <ConsolidatedTerminal
                key={`${sessionData.ptySessionId}-${terminalInstanceKey}`}
                ref={(el) => {
                  if (el) {
                    terminalRefs.current.set(terminalId, el);
                  } else {
                    terminalRefs.current.delete(terminalId);
                  }
                }}
                sessionId={sessionData.ptySessionId}
                workingDirectory={
                  sessionData.workspacePath || sessionData.repoPath
                }
                autoCommand={autoCommand}
                onSessionError={onSessionError}
                onClose={onClose}
                onTerminalOutput={handleTerminalOutput}
                onTerminalInput={onTerminalInput}
                onTerminalIdle={handleTerminalIdle}
                containerClassName="h-full w-full overflow-hidden"
                terminalPaneClassName="w-full h-full"
                isHidden={isHidden}
              />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              Loading...
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
