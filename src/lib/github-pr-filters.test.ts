import { describe, expect, it } from "vitest";
import type { GhPullRequest } from "./api-types";
import {
  EMPTY_PR_FILTERS,
  activePrFilterCount,
  filterPrs,
  prFilterOptions,
  prStackLevels,
} from "./github-pr-filters";

function pr(
  number: number,
  overrides: Partial<GhPullRequest> = {},
): GhPullRequest {
  return {
    number,
    title: `PR ${number}`,
    state: "OPEN",
    url: "",
    body: null,
    author: { login: "alice" },
    labels: [],
    head_ref_name: `feat/${number}`,
    base_ref_name: "main",
    merge_state_status: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    comments: null,
    ...overrides,
  };
}

const numbers = (prs: GhPullRequest[]) => prs.map((p) => p.number);

describe("prStackLevels", () => {
  it("counts how many PRs sit below each one in its stack", () => {
    const prs = [
      pr(1, { head_ref_name: "a", base_ref_name: "main" }),
      pr(2, { head_ref_name: "b", base_ref_name: "a" }),
      pr(3, { head_ref_name: "c", base_ref_name: "b" }),
      pr(4, { head_ref_name: "d", base_ref_name: "release" }),
    ];
    const levels = prStackLevels(prs);
    expect(levels.get(1)).toBe(1);
    expect(levels.get(2)).toBe(2);
    expect(levels.get(3)).toBe(3);
    expect(levels.get(4)).toBe(1);
  });

  it("terminates on a cycle", () => {
    const levels = prStackLevels([
      pr(1, { head_ref_name: "a", base_ref_name: "b" }),
      pr(2, { head_ref_name: "b", base_ref_name: "a" }),
    ]);
    expect(levels.get(1)).toBeGreaterThan(0);
    expect(levels.get(2)).toBeGreaterThan(0);
  });
});

describe("filterPrs", () => {
  const now = Date.parse("2026-09-30T00:00:00Z");
  const prs = [
    pr(1, {
      title: "Add login",
      author: { login: "alice" },
      head_ref_name: "a",
      labels: [{ name: "bug", color: "f00" }],
      created_at: "2026-09-29T00:00:00Z",
      merge_state_status: "DIRTY",
    }),
    pr(2, {
      title: "Stack on login",
      author: { login: "bob" },
      head_ref_name: "b",
      base_ref_name: "a",
      created_at: "2026-08-01T00:00:00Z",
      merge_state_status: "CLEAN",
    }),
    pr(3, { author: { login: "alice" }, head_ref_name: "c" }),
  ];

  it("returns everything with no filters", () => {
    expect(numbers(filterPrs(prs, EMPTY_PR_FILTERS, now))).toEqual([1, 2, 3]);
  });

  it("matches the search text against title, number, branch and author", () => {
    const f = (query: string) =>
      numbers(filterPrs(prs, { ...EMPTY_PR_FILTERS, query }, now));
    expect(f("LOGIN")).toEqual([1, 2]);
    expect(f("#3")).toEqual([3]);
    expect(f("bob")).toEqual([2]);
  });

  it("ANDs every filter together", () => {
    const filters = { ...EMPTY_PR_FILTERS, author: "alice", label: "bug" };
    expect(numbers(filterPrs(prs, filters, now))).toEqual([1]);
    expect(numbers(filterPrs(prs, { ...filters, author: "bob" }, now))).toEqual(
      [],
    );
  });

  it("filters by source and target branch", () => {
    expect(
      numbers(filterPrs(prs, { ...EMPTY_PR_FILTERS, base: "a" }, now)),
    ).toEqual([2]);
    expect(
      numbers(filterPrs(prs, { ...EMPTY_PR_FILTERS, head: "c" }, now)),
    ).toEqual([3]);
  });

  it("filters by stack level", () => {
    expect(
      numbers(filterPrs(prs, { ...EMPTY_PR_FILTERS, stackLevel: 2 }, now)),
    ).toEqual([2]);
  });

  it("filters by opened date", () => {
    expect(
      numbers(
        filterPrs(prs, { ...EMPTY_PR_FILTERS, openedWithinDays: 7 }, now),
      ),
    ).toEqual([1]);
  });

  it("filters by merge conflict state", () => {
    expect(
      numbers(
        filterPrs(prs, { ...EMPTY_PR_FILTERS, conflict: "conflicting" }, now),
      ),
    ).toEqual([1]);
    expect(
      numbers(filterPrs(prs, { ...EMPTY_PR_FILTERS, conflict: "clean" }, now)),
    ).toEqual([2]);
  });
});

describe("prFilterOptions", () => {
  it("lists the distinct values present in the loaded PRs, sorted", () => {
    const options = prFilterOptions([
      pr(1, {
        author: { login: "bob" },
        labels: [{ name: "ui", color: "0f0" }],
      }),
      pr(2, {
        author: { login: "alice" },
        head_ref_name: "x",
        base_ref_name: "feat/1",
      }),
      pr(3, { author: { login: "bob" } }),
    ]);
    expect(options.authors).toEqual(["alice", "bob"]);
    expect(options.labels).toEqual(["ui"]);
    expect(options.bases).toEqual(["feat/1", "main"]);
    expect(options.stackLevels).toEqual([1, 2]);
  });
});

describe("activePrFilterCount", () => {
  it("counts set filters but not the search text", () => {
    expect(activePrFilterCount(EMPTY_PR_FILTERS)).toBe(0);
    expect(
      activePrFilterCount({
        ...EMPTY_PR_FILTERS,
        query: "x",
        author: "a",
        stackLevel: 1,
      }),
    ).toBe(2);
  });
});
