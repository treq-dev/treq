import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowDown,
  CalendarClock,
  CircleHelp,
  ExternalLink,
  Layers2,
} from "lucide-react";

import useSWR from "swr";
import { listCommits, listWorkspaceStatuses, type Workspace } from "../lib/api";
import { WEB_URL } from "../lib/supabase";
import { cn, formatFullTimestamp, formatRelativeTime } from "../lib/utils";
import {
  sumWorkspaceDiffStats,
  type WorkspaceDiffStats,
} from "../lib/workspace-stack";
import {
  getWorkspaceStack,
  type StackedWorkspaceEntry,
} from "../lib/workspace-tree";
import { getWorkspaceDisplayTitle } from "../lib/workspace-utils";
import { Button } from "./ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import { WorkspaceLocIndicator } from "./WorkspaceLocIndicator";

const STACK_DOCS_URL = `${WEB_URL}/docs/concepts/workspaces#stacks-and-rebasing`;

interface WorkspaceStackPanelProps {
  repoPath: string;
  workspace: Workspace;
  /** The repo's default branch name, e.g. "main" */
  defaultBranch: string;
  onSelectWorkspace?: (workspace: Workspace) => void;
  onScheduleStack?: (workspaces: Workspace[]) => void;
}

/**
 * Shows the chain of workspaces stacked on top of one another (a la a
 * stacked-PR view), with the current workspace highlighted. Renders nothing
 * when the given workspace isn't part of a multi-workspace stack (alone on
 * the default/external branch with no stacked descendants).
 */
export const WorkspaceStackPanel = ({
  repoPath,
  workspace,
  defaultBranch,
  onSelectWorkspace,
  onScheduleStack,
}: WorkspaceStackPanelProps) => {
  const { data: workspaceStatuses } = useSWR(
    repoPath ? ["workspace-statuses", repoPath] : null,
    () => listWorkspaceStatuses(repoPath),
  );

  const stack = (() => {
    if (!workspaceStatuses) return null;
    // A workspace record can exist for the repo's own default branch
    // (surfaced in the sidebar for target-branch bookkeeping). It isn't
    // a real stacked workspace, so it must not count as an ancestor.
    const allWorkspaces = workspaceStatuses
      .map((status) => status.current)
      .filter((ws) => ws.branch_name !== defaultBranch);
    return getWorkspaceStack(allWorkspaces, workspace.id);
  })();

  const stackIds = (stack ?? []).map((entry) => entry.workspace.id);
  const { data: commitLists } = useSWR(
    repoPath && stackIds.length > 0
      ? ["workspace-commits-stack", repoPath, stackIds.join(",")]
      : null,
    () => Promise.all(stackIds.map((id) => listCommits(repoPath, id))),
  );

  const diffStatsByWorkspaceId = (() => {
    const map = new Map<number, WorkspaceDiffStats>();
    (stack ?? []).forEach((entry, index) => {
      map.set(
        entry.workspace.id,
        sumWorkspaceDiffStats(commitLists?.[index]?.commits ?? []),
      );
    });
    return map;
  })();

  // Each side of the bar is sized relative to the largest single-direction
  // change (insertions or deletions) in the stack, a la Gerrit's change
  // list.
  const maxChange = Math.max(
    0,
    ...Array.from(diffStatsByWorkspaceId.values()).map((stats) =>
      Math.max(stats.insertions, stats.deletions),
    ),
  );

  if (!stack) return null;

  const currentIndex = stack.findIndex((entry) => entry.isCurrent);

  return (
    <div data-testid="workspace-stack-panel" className="border rounded-lg p-4">
      <div className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground mb-4">
        <Layers2 className="w-4 h-4" />
        <span>Stack</span>
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="What is a stack?"
                className="inline-flex items-center justify-center rounded-sm text-muted-foreground/70 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <CircleHelp className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs font-normal">
              <p>
                A stack is a chain of workspaces that build on each other. Each
                targets the workspace below it instead of the default branch.
                Click a workspace to navigate to it.
              </p>
              <button
                type="button"
                className="mt-1.5 inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
                onClick={() => openUrl(STACK_DOCS_URL)}
                onPointerDown={(event) => event.preventDefault()}
              >
                Learn more
                <ExternalLink className="w-3 h-3" />
              </button>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <span className="ml-auto flex items-center gap-2 text-xs font-normal">
          {onScheduleStack && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              data-testid="schedule-stack-button"
              onClick={() =>
                onScheduleStack(stack.map((entry) => entry.workspace))
              }
            >
              <CalendarClock className="w-3.5 h-3.5" />
              Schedule
            </Button>
          )}
          <span>
            {currentIndex + 1} of {stack.length}
          </span>
        </span>
      </div>
      <div className="relative">
        <div
          className="absolute left-[7px] top-2 bottom-2 w-0.5 bg-border"
          aria-hidden="true"
        />
        <ul className="space-y-0">
          {stack.map((entry) => (
            <StackItem
              key={entry.workspace.id}
              entry={entry}
              diffStats={
                diffStatsByWorkspaceId.get(entry.workspace.id) ?? {
                  insertions: 0,
                  deletions: 0,
                }
              }
              maxChange={maxChange}
              onSelect={onSelectWorkspace}
            />
          ))}
          <li>
            <div className="relative z-10 flex w-full items-start gap-3 py-2 px-2 -mx-2 text-muted-foreground">
              <div className="flex-shrink-0 mt-0.5 w-[14px] h-[14px] flex items-center justify-center">
                <ArrowDown className="w-3.5 h-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-mono truncate">{defaultBranch}</p>
              </div>
            </div>
          </li>
        </ul>
      </div>
    </div>
  );
};

// Diff bar sizing lives in WorkspaceLocIndicator (Gerrit-style LOC display).

interface StackItemProps {
  entry: StackedWorkspaceEntry;
  diffStats: WorkspaceDiffStats;
  maxChange: number;
  onSelect?: (workspace: Workspace) => void;
}

function StackItem({ entry, diffStats, maxChange, onSelect }: StackItemProps) {
  const { workspace, isCurrent } = entry;
  const hasStats = diffStats.insertions > 0 || diffStats.deletions > 0;
  const title = getWorkspaceDisplayTitle(workspace);

  return (
    <li>
      <button
        type="button"
        data-testid={`workspace-stack-item-${workspace.id}`}
        aria-current={isCurrent ? "true" : undefined}
        onClick={() => onSelect?.(workspace)}
        className={cn(
          "relative z-10 flex w-full items-start gap-3 py-2 px-2 -mx-2 rounded-md text-left transition-all duration-200",
          isCurrent
            ? "bg-primary/10 border border-primary/40 shadow-sm"
            : "hover:bg-muted",
        )}
      >
        <div className="flex-shrink-0 mt-0.5">
          <div
            className={cn(
              "w-[14px] h-[14px] rounded-full border-2 border-background",
              isCurrent ? "bg-primary" : "bg-muted-foreground",
            )}
          />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm truncate" title={title}>
            {title}
          </p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-xs text-muted-foreground">
                    {formatRelativeTime(workspace.created_at)}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{formatFullTimestamp(workspace.created_at)}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {hasStats && (
              <WorkspaceLocIndicator
                className="ml-auto"
                diffStats={diffStats}
                maxChange={maxChange}
              />
            )}
          </div>
        </div>
      </button>
    </li>
  );
}
