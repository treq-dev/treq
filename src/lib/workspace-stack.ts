import type {
  JjLogCommit,
  JjLogResult,
  JjTentativeWorkingCopy,
} from "./api-types";

export interface WorkspaceDiffStats {
  insertions: number;
  deletions: number;
}

/**
 * Sum insertions/deletions across a workspace's own commits, excluding
 * commits that only belong to the target branch (`on_target_only`).
 * When `tentativeWorkingCopy` is provided, its LOC is included so the
 * total covers committed + uncommitted working-copy changes.
 */
export function sumWorkspaceDiffStats(
  commits: JjLogCommit[],
  tentativeWorkingCopy?: JjTentativeWorkingCopy | null,
): WorkspaceDiffStats {
  const fromCommits = commits.reduce<WorkspaceDiffStats>(
    (totals, commit) => {
      if (commit.on_target_only) return totals;
      return {
        insertions: totals.insertions + commit.insertions,
        deletions: totals.deletions + commit.deletions,
      };
    },
    { insertions: 0, deletions: 0 },
  );

  if (!tentativeWorkingCopy) return fromCommits;

  return {
    insertions: fromCommits.insertions + tentativeWorkingCopy.commit.insertions,
    deletions: fromCommits.deletions + tentativeWorkingCopy.commit.deletions,
  };
}

/** Aggregate LOC for a workspace from a `listCommits` result (commits + WC). */
export function sumWorkspaceLocFromLog(
  result: Pick<JjLogResult, "commits" | "tentative_working_copy">,
): WorkspaceDiffStats {
  return sumWorkspaceDiffStats(
    result.commits ?? [],
    result.tentative_working_copy,
  );
}

/** Character columns for a signed LOC count (`+1234` / `-12`), including the sign. */
export function locSignedCountCh(n: number): number {
  return String(Math.max(0, Math.trunc(n))).length + 1;
}

/**
 * Shared `ch` widths for a stack of LOC indicators so the bar's middle
 * axis lines up across rows regardless of per-row digit count.
 */
export function stackLocColumnCh(stats: Iterable<WorkspaceDiffStats>): {
  insertionsCh: number;
  deletionsCh: number;
} {
  let maxInsertions = 0;
  let maxDeletions = 0;
  for (const { insertions, deletions } of stats) {
    maxInsertions = Math.max(maxInsertions, insertions);
    maxDeletions = Math.max(maxDeletions, deletions);
  }
  return {
    insertionsCh: locSignedCountCh(maxInsertions),
    deletionsCh: locSignedCountCh(maxDeletions),
  };
}
