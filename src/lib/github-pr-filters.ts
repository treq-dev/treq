import type { GhPullRequest } from "./api-types";

/** Client-side filters over the loaded PR pages. Every set field must match. */
export interface PrFilters {
  // Free text matched against title, number, branches and author.
  query: string;
  author: string | null;
  // Source branch (`headRefName`).
  head: string | null;
  // Target branch (`baseRefName`).
  base: string | null;
  stackLevel: number | null;
  openedWithinDays: number | null;
  conflict: "conflicting" | "clean" | null;
  label: string | null;
}

export const EMPTY_PR_FILTERS: PrFilters = {
  query: "",
  author: null,
  head: null,
  base: null,
  stackLevel: null,
  openedWithinDays: null,
  conflict: null,
  label: null,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Stack level per PR: 1 at the bottom, +1 for each listed PR below it. */
export function prStackLevels(prs: GhPullRequest[]): Map<number, number> {
  const byHead = new Map<string, GhPullRequest>();
  for (const pr of prs) byHead.set(pr.head_ref_name, pr);
  const levels = new Map<number, number>();
  for (const pr of prs) {
    const seen = new Set<number>();
    let level = 1;
    let parent = byHead.get(pr.base_ref_name);
    while (parent && !seen.has(parent.number) && parent.number !== pr.number) {
      seen.add(parent.number);
      level++;
      parent = byHead.get(parent.base_ref_name);
    }
    levels.set(pr.number, level);
  }
  return levels;
}

function matchesQuery(pr: GhPullRequest, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    pr.title,
    `#${pr.number}`,
    pr.head_ref_name,
    pr.base_ref_name,
    pr.author.login,
  ].some((field) => field.toLowerCase().includes(q));
}

function matchesConflict(
  pr: GhPullRequest,
  conflict: PrFilters["conflict"],
): boolean {
  if (!conflict) return true;
  const status = pr.merge_state_status?.toUpperCase();
  if (conflict === "conflicting") return status === "DIRTY";
  // An unknown status is not proof of "no conflicts".
  return !!status && status !== "DIRTY" && status !== "UNKNOWN";
}

export function filterPrs(
  prs: GhPullRequest[],
  filters: PrFilters,
  now = Date.now(),
): GhPullRequest[] {
  const levels =
    filters.stackLevel != null ? prStackLevels(prs) : new Map<number, number>();
  return prs.filter(
    (pr) =>
      matchesQuery(pr, filters.query) &&
      (!filters.author || pr.author.login === filters.author) &&
      (!filters.head || pr.head_ref_name === filters.head) &&
      (!filters.base || pr.base_ref_name === filters.base) &&
      (filters.stackLevel == null ||
        levels.get(pr.number) === filters.stackLevel) &&
      (filters.openedWithinDays == null ||
        now - Date.parse(pr.created_at) <= filters.openedWithinDays * DAY_MS) &&
      matchesConflict(pr, filters.conflict) &&
      (!filters.label || pr.labels.some((l) => l.name === filters.label)),
  );
}

/** Number of set filters, excluding the search text. */
export function activePrFilterCount(filters: PrFilters): number {
  return (Object.keys(filters) as (keyof PrFilters)[]).filter(
    (key) => key !== "query" && filters[key] != null,
  ).length;
}

const sorted = (values: Iterable<string>) =>
  [...new Set(values)].sort((a, b) => a.localeCompare(b));

/** Distinct values in the loaded PRs, for the filter dropdowns. */
export function prFilterOptions(prs: GhPullRequest[]) {
  return {
    authors: sorted(prs.map((pr) => pr.author.login)),
    heads: sorted(prs.map((pr) => pr.head_ref_name)),
    bases: sorted(prs.map((pr) => pr.base_ref_name)),
    labels: sorted(prs.flatMap((pr) => pr.labels.map((l) => l.name))),
    stackLevels: [...new Set(prStackLevels(prs).values())].sort(
      (a, b) => a - b,
    ),
  };
}
