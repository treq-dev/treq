import { openUrl } from "@tauri-apps/plugin-opener";
import type { MutationResult } from "../../hooks/useMutation";
import {
  ArrowDown,
  Check,
  CircleHelp,
  Copy,
  ExternalLink,
  GitMerge,
  Layers2,
  Rocket,
} from "lucide-react";
import { useState } from "react";
import type { QueueEntryStatus } from "../../lib/api-types";
import { type QueueEntry, type QueueStack } from "../../lib/merge-queue-stacks";
import { WEB_URL } from "../../lib/supabase";
import type { WorkspaceDiffStats } from "../../lib/workspace-stack";
import { DiffStatsInline } from "../DiffBar";
import { Button } from "../ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";

const STACK_DOCS_URL = `${WEB_URL}/docs/concepts/workspaces#stacks-and-rebasing`;

function queueStatusLabel(status: QueueEntryStatus): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "testing":
      return "Running checks";
    case "merging":
      return "Merging";
    case "merged":
      return "Merged";
    case "failed":
      return "Failed";
    case "dequeued":
      return "Dequeued";
    default:
      return status;
  }
}

function queueNodeColor(status: QueueEntryStatus): string {
  switch (status) {
    case "testing":
      return "bg-amber-500";
    case "merging":
      return "bg-green-500 animate-pulse";
    case "merged":
      return "bg-green-600";
    case "failed":
      return "bg-red-500";
    default:
      return "bg-muted-foreground";
  }
}

function QueueStatusChip({ status }: { status: QueueEntryStatus }) {
  const color =
    status === "testing"
      ? "bg-amber-500/20 text-amber-600 dark:text-amber-400"
      : status === "failed"
        ? "bg-red-500/20 text-red-600 dark:text-red-400"
        : status === "merged" || status === "merging"
          ? "bg-green-500/20 text-green-600 dark:text-green-400"
          : "bg-muted text-muted-foreground";

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${color}`}
    >
      {queueStatusLabel(status)}
    </span>
  );
}

function stackMaxChange(entries: readonly QueueEntry[]): number {
  return Math.max(
    0,
    ...entries.map((entry) =>
      Math.max(entry.insertions ?? 0, entry.deletions ?? 0),
    ),
  );
}

function StackHelpTooltip({ targetBranch }: { targetBranch: string }) {
  return (
    <TooltipProvider delay={200}>
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
            Stacked PRs merge bottom-up into {targetBranch}: the lowest PR lands
            first, then each PR above it.
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
  );
}

export function TargetBranchMarker({
  targetBranch,
  tipShortId,
  tipCommitId,
  tipPrNumber,
  tipPrTitle,
}: {
  targetBranch: string;
  tipShortId: string | null;
  tipCommitId: string | null;
  tipPrNumber: number | null;
  tipPrTitle: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const copyValue = tipCommitId ?? tipShortId;
  const title =
    tipPrTitle?.trim() || (tipPrNumber != null ? `PR #${tipPrNumber}` : null);

  async function handleCopy() {
    if (!copyValue) return;
    try {
      await navigator.clipboard.writeText(copyValue);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable in some test / WebView contexts.
    }
  }

  return (
    <div
      className="relative z-10 flex items-center gap-3 py-2 pl-4 text-muted-foreground"
      data-testid="merge-queue-target"
    >
      <div className="shrink-0 w-[14px] h-[14px] flex items-center justify-center">
        <ArrowDown className="w-3.5 h-3.5" />
      </div>
      <div className="min-w-0 flex-1 flex items-center gap-2">
        <div className="min-w-0 flex items-center gap-2">
          <span
            className="inline-flex items-center shrink-0 px-1.5 py-0.5 rounded text-xs font-mono font-medium bg-muted text-foreground"
            data-testid="merge-queue-target-branch"
          >
            {targetBranch}
          </span>
          {title && (
            <span className="text-sm text-foreground truncate min-w-0">
              {title}
            </span>
          )}
        </div>
        {tipShortId && (
          <div className="ml-auto flex items-center gap-0.5 shrink-0">
            <span
              className="text-xs font-mono text-muted-foreground"
              data-testid="merge-queue-tip-sha"
            >
              {tipShortId}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground"
              aria-label={copied ? "Commit SHA copied" : "Copy commit SHA"}
              title={copied ? "Copied" : "Copy commit SHA"}
              onClick={() => void handleCopy()}
            >
              {copied ? (
                <Check className="w-3 h-3" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function MergeQueueUpsell() {
  return (
    <div className="flex items-center justify-center h-full p-6">
      <div className="max-w-md w-full rounded-xl border border-border bg-gradient-to-br from-muted/40 via-background to-green-500/5 p-8 text-center space-y-4">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-500/15 text-green-600 dark:text-green-400">
          <Rocket className="w-6 h-6" />
        </div>
        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 text-base font-semibold tracking-wide px-1.5 py-0.5 rounded bg-green-500/20 text-green-700 dark:text-green-400">
            PRO
          </div>
          <h2 className="text-lg font-semibold tracking-tight">
            Unlock Merge Queue
          </h2>
          <p className="text-base text-muted-foreground leading-relaxed">
            Queue stacked PRs, run CI in parallel lanes, and merge with
            confidence. Upgrade to Pro to manage your repository&apos;s merge
            queue from Treq.
          </p>
        </div>
        <Button
          size="lg"
          className="gap-2 w-full bg-green-600 hover:bg-green-700 text-white"
          onClick={() => openUrl(`${WEB_URL}/dashboard`)}
        >
          <Rocket className="w-4 h-4" />
          Upgrade to Pro
        </Button>
      </div>
    </div>
  );
}

interface MergeQueueDisabledProps {
  onOpenSettings?: (tab?: string) => void;
}

export function MergeQueueDisabled({
  onOpenSettings,
}: MergeQueueDisabledProps) {
  return (
    <div
      data-testid="merge-queue-disabled"
      className="flex flex-col items-center justify-center h-full text-center p-8 gap-3"
    >
      <GitMerge className="w-8 h-8 text-muted-foreground" />
      <p className="text-base text-muted-foreground">
        The merge queue is off for this repository.
      </p>
      <Button
        variant="outline"
        size="sm"
        className="text-base"
        onClick={() => onOpenSettings?.("integrations")}
      >
        Enable it in Settings › Integrations
      </Button>
    </div>
  );
}

interface QueueStackBlockProps {
  stack: QueueStack;
  dequeueBranches: MutationResult<string[], string[]>;
  /** History stacks are read-only — no Remove controls. */
  showRemove?: boolean;
}

export function QueueStackBlock({
  stack,
  dequeueBranches,
  showRemove = true,
}: QueueStackBlockProps) {
  // `stack.entries` stays merge-order (root first) for dequeue; reverse only
  // for display so the next-to-merge PR sits at the bottom of the card.
  const displayEntries = [...stack.entries].reverse();
  const isStack = stack.entries.length > 1;
  const stackKey = stack.entries[0].branch_name;
  const maxChange = stackMaxChange(stack.entries);

  return (
    <div
      data-testid={
        isStack
          ? `merge-queue-stack-${stackKey}`
          : `merge-queue-single-${stackKey}`
      }
      className="border rounded-lg p-4 bg-background"
    >
      {isStack && (
        <div className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground mb-3 pl-[26px]">
          <Layers2 className="w-4 h-4 shrink-0" />
          <span>Stack of {stack.entries.length}</span>
          <StackHelpTooltip targetBranch={stack.targetBranch} />
          <div className="flex-1" />
          {showRemove && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-base shrink-0 font-normal"
              disabled={dequeueBranches.isPending}
              aria-label={`Remove stack of ${stack.entries.length} from queue`}
              onClick={() =>
                dequeueBranches.mutate(stack.entries.map((e) => e.branch_name))
              }
            >
              Remove
            </Button>
          )}
        </div>
      )}

      {/*
        Per-card rail is omitted on purpose: a single continuous rail on the
        list container runs through every card and the gaps between them.
      */}
      <div className="relative">
        <ul className="space-y-0">
          {displayEntries.map((entry) => {
            const insertions = entry.insertions ?? 0;
            const deletions = entry.deletions ?? 0;
            return (
              <li
                key={entry.branch_name}
                data-testid={`merge-queue-entry-${entry.position}`}
                className="relative z-10 flex w-full items-start gap-3 py-2"
              >
                <div className="flex-shrink-0 mt-0.5 w-[14px] h-[14px] flex items-center justify-center">
                  <div
                    className={`w-[14px] h-[14px] rounded-full border-2 border-background ${queueNodeColor(entry.status)}`}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-muted-foreground tabular-nums shrink-0">
                      #{entry.position}
                    </span>
                    <span className="text-sm font-medium truncate">
                      {entry.pr_number != null
                        ? `PR #${entry.pr_number}`
                        : "No PR"}
                    </span>
                    {showRemove && !isStack && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-base shrink-0 font-normal ml-auto"
                        disabled={dequeueBranches.isPending}
                        aria-label={`Remove ${entry.branch_name} from queue`}
                        onClick={() =>
                          dequeueBranches.mutate([entry.branch_name])
                        }
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap min-w-0">
                    <QueueStatusChip status={entry.status} />
                    <p className="text-xs font-mono text-muted-foreground truncate min-w-0">
                      {entry.branch_name} → {entry.target_branch}
                    </p>
                    <DiffStatsInline
                      insertions={insertions}
                      deletions={deletions}
                      maxChange={maxChange}
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/**
 * Overlay local workspace commit LOC onto queue entries that don't already
 * carry insertions/deletions (e.g. from fixtures or a future RPC).
 */
export function mergeLocalDiffStats(
  entries: readonly QueueEntry[],
  statsByBranch: Map<string, WorkspaceDiffStats>,
): QueueEntry[] {
  return entries.map((entry) => {
    if (entry.insertions != null || entry.deletions != null) return entry;
    const stats = statsByBranch.get(entry.branch_name);
    if (!stats) return entry;
    return {
      ...entry,
      insertions: stats.insertions,
      deletions: stats.deletions,
    };
  });
}
