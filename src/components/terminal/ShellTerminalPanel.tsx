import React from "react";
import useSWR from "swr";
import { Terminal, X } from "lucide-react";
import { ConsolidatedTerminal } from "../ConsolidatedTerminal";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { Button } from "../ui/button";
import { Kbd, KbdGroup } from "../ui/kbd";
import { cn } from "../../lib/utils";
import { getTreqBinDir } from "../../lib/api";
import { type ShellTerminalData, type TerminalRefsMap } from "./types";
import { TerminalSendPreviews } from "./TerminalSendPreviews";

interface ShellTerminalPanelProps {
  terminalData: ShellTerminalData;
  collapsed: boolean;
  isActive?: boolean;
  onFocus?: () => void;
  onDoubleClick?: () => void;
  onClose?: () => void;
  canClose: boolean;
  onSessionError?: (message: string) => void;
  onTerminalOutput?: (output: string, fromProcess?: boolean) => void;
  onTerminalInput?: () => void;
  onTerminalIdle?: () => void;
  terminalRefs: React.MutableRefObject<TerminalRefsMap>;
  width?: number | null;
}

export const ShellTerminalPanel = ({
  terminalData,
  collapsed,
  isActive,
  onFocus,
  onDoubleClick,
  onClose,
  canClose,
  onSessionError,
  onTerminalOutput,
  onTerminalInput,
  onTerminalIdle,
  terminalRefs,
  width,
}: ShellTerminalPanelProps) => {
  const isHidden = collapsed;
  const { data: binDir } = useSWR("treq-bin-dir", getTreqBinDir);
  const pathAutoCommand = binDir ? `export PATH="${binDir}:$PATH"` : undefined;

  return (
    <div
      data-terminal-id={terminalData.id}
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
          isActive ? "bg-primary/20" : "bg-background",
        )}
        onDoubleClick={onDoubleClick}
      >
        <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground min-w-0">
          <Terminal className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">Shell</span>
        </div>
        {canClose && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  onClick={onClose}
                  variant="ghost"
                  className="h-4 w-4 rounded-sm p-0 opacity-60 hover:opacity-100"
                  aria-label="Close shell"
                >
                  <X className="w-3 h-3" />
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

      {/* Terminal */}
      <div
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden border-r border-border"
        style={{ backgroundColor: "#1e1e1e" }}
      >
        <TerminalSendPreviews
          ptySessionId={terminalData.id}
          isActive={!!isActive}
        />
        <ConsolidatedTerminal
          ref={(el) => {
            if (el) {
              terminalRefs.current.set(terminalData.id, el);
            } else {
              terminalRefs.current.delete(terminalData.id);
            }
          }}
          sessionId={terminalData.id}
          workingDirectory={terminalData.workingDirectory}
          autoCommand={pathAutoCommand}
          onSessionError={onSessionError}
          onTerminalOutput={onTerminalOutput}
          onTerminalInput={onTerminalInput}
          onTerminalIdle={onTerminalIdle}
          onClose={onClose}
          containerClassName="h-full w-full overflow-hidden"
          terminalPaneClassName="w-full h-full"
          isHidden={isHidden}
        />
      </div>
    </div>
  );
};
