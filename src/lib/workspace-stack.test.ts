import { describe, expect, it } from "vitest";
import type { JjLogCommit } from "./api-types";
import {
  locSignedCountCh,
  stackLocColumnCh,
  sumWorkspaceDiffStats,
  sumWorkspaceLocFromLog,
} from "./workspace-stack";

function makeCommit(overrides: Partial<JjLogCommit> = {}): JjLogCommit {
  return {
    commit_id: "abc",
    short_id: "abc",
    change_id: "chg",
    description: "Add feature",
    author_name: "Test User",
    timestamp: "2026-01-01T00:00:00.000Z",
    parent_ids: [],
    is_working_copy: false,
    bookmarks: [],
    is_immutable: false,
    insertions: 0,
    deletions: 0,
    on_target_only: false,
    ...overrides,
  };
}

describe("sumWorkspaceDiffStats", () => {
  it("returns zero for an empty commit list", () => {
    expect(sumWorkspaceDiffStats([])).toEqual({ insertions: 0, deletions: 0 });
  });

  it("sums insertions and deletions across own-workspace commits", () => {
    const commits = [
      makeCommit({ insertions: 5, deletions: 2 }),
      makeCommit({ insertions: 3, deletions: 1 }),
    ];
    expect(sumWorkspaceDiffStats(commits)).toEqual({
      insertions: 8,
      deletions: 3,
    });
  });

  it("excludes commits that are on_target_only", () => {
    const commits = [
      makeCommit({ insertions: 5, deletions: 2 }),
      makeCommit({ insertions: 100, deletions: 100, on_target_only: true }),
    ];
    expect(sumWorkspaceDiffStats(commits)).toEqual({
      insertions: 5,
      deletions: 2,
    });
  });

  it("adds tentative working-copy insertions and deletions", () => {
    const commits = [makeCommit({ insertions: 5, deletions: 2 })];
    const tentative = {
      workspace_label: "feat/thing",
      commit: makeCommit({
        is_working_copy: true,
        insertions: 4,
        deletions: 1,
      }),
    };
    expect(sumWorkspaceDiffStats(commits, tentative)).toEqual({
      insertions: 9,
      deletions: 3,
    });
  });
});

describe("sumWorkspaceLocFromLog", () => {
  it("sums commits plus tentative working copy from a listCommits result", () => {
    expect(
      sumWorkspaceLocFromLog({
        commits: [
          makeCommit({ insertions: 10, deletions: 6 }),
          makeCommit({ insertions: 50, deletions: 50, on_target_only: true }),
        ],
        tentative_working_copy: {
          workspace_label: "feat/thing",
          commit: makeCommit({
            is_working_copy: true,
            insertions: 2,
            deletions: 3,
          }),
        },
      }),
    ).toEqual({ insertions: 12, deletions: 9 });
  });

  it("handles a result with no tentative working copy", () => {
    expect(
      sumWorkspaceLocFromLog({
        commits: [makeCommit({ insertions: 1, deletions: 0 })],
      }),
    ).toEqual({ insertions: 1, deletions: 0 });
  });
});

describe("locSignedCountCh", () => {
  it("includes the sign plus digit count", () => {
    expect(locSignedCountCh(0)).toBe(2);
    expect(locSignedCountCh(9)).toBe(2);
    expect(locSignedCountCh(10)).toBe(3);
    expect(locSignedCountCh(18724)).toBe(6);
  });
});

describe("stackLocColumnCh", () => {
  it("sizes columns to the widest insertion and deletion in the set", () => {
    expect(
      stackLocColumnCh([
        { insertions: 253, deletions: 18277 },
        { insertions: 61, deletions: 61 },
        { insertions: 18724, deletions: 477 },
      ]),
    ).toEqual({ insertionsCh: 6, deletionsCh: 6 });
  });
});
