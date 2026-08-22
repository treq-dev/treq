import { Bot, Moon, SquareTerminal, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  isTerminalSessionIdle,
  type TerminalSessionSummary,
} from "./terminal/types";
import {
  createSessionOrderState,
  nextTerminalSessionOrder,
} from "./terminal/nextTerminalSessionOrder";
import { TerminalSessionsSidebarItem } from "./TerminalSessionsSidebarItem";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

interface TerminalSessionsSidebarProps {
  sessions: TerminalSessionSummary[];
  onFocus?: (id: string) => void;
  onClose?: (id: string) => void;
  onCloseIdle?: () => void;
  onCloseAll?: () => void;
  onCreateAgent?: () => void;
  onCreateShell?: () => void;
}

// How often to force a re-render so idle status and last-activity ordering
// stay live even when no new terminal output arrives.
const TICK_INTERVAL_MS = 5000;
// Keep reorders noticeable without making items travel/bounce across the list.
const REORDER_TRANSITION_MS = 180;
const REORDER_OFFSET_PX = 8;

export const TerminalSessionsSidebar: React.FC<
  TerminalSessionsSidebarProps
> = ({
  sessions,
  onFocus,
  onClose,
  onCloseIdle,
  onCloseAll,
  onCreateAgent,
  onCreateShell,
}) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), TICK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const orderStateRef = useRef(createSessionOrderState());
  const orderedSessions = (() => {
    orderStateRef.current = nextTerminalSessionOrder(
      orderStateRef.current,
      sessions,
      now,
    );
    const byId = new Map(sessions.map((session) => [session.id, session]));
    return orderStateRef.current.order.flatMap((id) => {
      const session = byId.get(id);
      return session ? [session] : [];
    });
  })();

  const idleCount = orderedSessions.filter((s) =>
    isTerminalSessionIdle(s, now),
  ).length;

  const orderedSessionIds = orderedSessions.map((session) => session.id).join();

  // FLIP reorder animation: capture each item's position before the reorder
  // takes effect in the DOM, then animate from the old position to the new
  // one so terminals that jump to the top (active changes) visibly slide.
  const listRef = useRef<HTMLDivElement>(null);
  const prevRectsRef = useRef<Map<string, DOMRect>>(new Map());
  useLayoutEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const nodes = container.querySelectorAll<HTMLElement>("[data-flip-id]");
    const nextRects = new Map<string, DOMRect>();
    nodes.forEach((node) => {
      const id = node.dataset.flipId;
      if (!id) return;
      const rect = node.getBoundingClientRect();
      nextRects.set(id, rect);
      const prevRect = prevRectsRef.current.get(id);
      if (prevRect) {
        const fullDistance = prevRect.top - rect.top;
        const dy = Math.max(
          -REORDER_OFFSET_PX,
          Math.min(REORDER_OFFSET_PX, fullDistance),
        );
        if (dy) {
          node.style.transition = "none";
          node.style.transform = `translateY(${dy}px)`;
          requestAnimationFrame(() => {
            node.style.transition = `transform ${REORDER_TRANSITION_MS}ms cubic-bezier(0.2, 0, 0, 1)`;
            node.style.transform = "";
          });
        }
      }
    });
    prevRectsRef.current = nextRects;
  }, [orderedSessionIds]);

  return (
    <div className="border-t border-border flex-shrink-0 flex flex-col">
      <div className="h-8 flex items-center justify-between px-2">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
          Sessions
        </h4>
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label="New agent terminal"
                onClick={onCreateAgent}
              >
                <Bot className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">New agent terminal</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label="New shell terminal"
                onClick={onCreateShell}
              >
                <SquareTerminal className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">New shell terminal</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label="Close idle terminals"
                disabled={idleCount === 0}
                onClick={onCloseIdle}
              >
                <Moon className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              Close idle terminals{idleCount > 0 ? ` (${idleCount})` : ""}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label="Close all terminals"
                disabled={orderedSessions.length === 0}
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={onCloseAll}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Close all terminals</TooltipContent>
          </Tooltip>
        </div>
      </div>
      {orderedSessions.length > 0 && (
        <div
          ref={listRef}
          data-testid="terminal-sessions-list"
          className="max-h-[220px] overflow-y-auto px-1 pb-2 space-y-0.5"
        >
          {orderedSessions.map((session) => (
            <TerminalSessionsSidebarItem
              key={session.id}
              session={session}
              now={now}
              onFocus={onFocus}
              onClose={onClose}
            />
          ))}
        </div>
      )}
    </div>
  );
};
