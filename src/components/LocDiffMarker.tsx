import { cn } from "../lib/utils";
import type { WorkspaceDiffStats } from "../lib/workspace-stack";

/** Half-width of each side of the bar (insertions grow left, deletions right). */
const DIFF_BAR_HALF_WIDTH_PX = 14;

export interface LocDiffMarkerProps {
  diffStats: WorkspaceDiffStats;
  /**
   * Scale reference for the bar width. Defaults to
   * `max(insertions, deletions)` so a lone marker fills the larger side.
   */
  maxChange?: number;
  className?: string;
  "data-testid"?: string;
}

/**
 * Gerrit-style LOC marker: green `+N`, centered insertion/deletion bar,
 * red `-N`. Renders nothing when both sides are zero.
 */
export function LocDiffMarker({
  diffStats,
  maxChange,
  className,
  "data-testid": testId = "loc-diff-marker",
}: LocDiffMarkerProps) {
  const { insertions, deletions } = diffStats;
  if (insertions === 0 && deletions === 0) return null;

  const scale = maxChange ?? Math.max(insertions, deletions);

  const insertionWidth =
    scale === 0 || insertions === 0
      ? 0
      : Math.max(1, Math.round((insertions / scale) * DIFF_BAR_HALF_WIDTH_PX));
  const deletionWidth =
    scale === 0 || deletions === 0
      ? 0
      : Math.max(1, Math.round((deletions / scale) * DIFF_BAR_HALF_WIDTH_PX));

  return (
    <div
      data-testid={testId}
      className={cn("flex items-center gap-1.5", className)}
      title={`+${insertions} −${deletions}`}
    >
      <span className="text-xs font-mono text-green-600 dark:text-green-400">
        +{insertions}
      </span>
      <div className="flex h-1.5 flex-shrink-0 items-center" aria-hidden="true">
        <div
          className="flex h-full justify-end"
          style={{ width: DIFF_BAR_HALF_WIDTH_PX }}
        >
          <div
            className="h-full bg-green-600 dark:bg-green-400"
            style={{ width: insertionWidth }}
          />
        </div>
        <div className="w-px h-full bg-border" />
        <div
          className="flex h-full justify-start"
          style={{ width: DIFF_BAR_HALF_WIDTH_PX }}
        >
          <div
            className="h-full bg-red-600 dark:bg-red-400"
            style={{ width: deletionWidth }}
          />
        </div>
      </div>
      <span className="text-xs font-mono text-red-600 dark:text-red-400">
        -{deletions}
      </span>
    </div>
  );
}
