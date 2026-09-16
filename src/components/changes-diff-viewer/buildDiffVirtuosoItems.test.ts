import { describe, expect, it } from "vitest";
import { buildDiffVirtuosoItems } from "./buildDiffVirtuosoItems";
import type { ParsedFileChange } from "../../lib/git-utils";
import type { FileHunksData } from "./types";

function file(path: string): ParsedFileChange {
  return { path, workspaceStatus: "M", isConflicted: false };
}

function hunks(path: string, lines: string[]): Map<string, FileHunksData> {
  return new Map([
    [
      path,
      {
        filePath: path,
        isLoading: false,
        hunks: [
          {
            id: "h1",
            header: `@@ -1,0 +1,${lines.length} @@`,
            lines,
            patch: "",
          },
        ],
      },
    ],
  ]);
}

const emptyFns = {
  getFileCommentsForFile: () => [],
  getOutdatedCommentsForFile: () => [],
  getUnplacedThreadsForFile: () => [],
};

describe("buildDiffVirtuosoItems", () => {
  it("emits a single header item for a collapsed file", () => {
    const path = "a.ts";
    const { items, maps } = buildDiffVirtuosoItems({
      actualConflictedFiles: [],
      allFileHunks: hunks(path, ["+one", "+two"]),
      collapsedFiles: new Set([path]),
      committedFileHunks: new Map(),
      committedFiles: [],
      conflictLineLookups: new Map(),
      expandedContext: new Map(),
      expandedLargeDiffs: new Set(),
      files: [file(path)],
      pendingComment: null,
      showCommentInput: false,
      viewedFiles: new Map(),
      ...emptyFns,
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "file-header", completeCard: true });
    expect(maps.filePathToIndex.get(path)).toBe(0);
  });

  it("emits one diff-line item per hunk line when expanded", () => {
    const path = "a.ts";
    const lines = ["+one", "+two", "+three"];
    const { items, maps } = buildDiffVirtuosoItems({
      actualConflictedFiles: [],
      allFileHunks: hunks(path, lines),
      collapsedFiles: new Set(),
      committedFileHunks: new Map(),
      committedFiles: [],
      conflictLineLookups: new Map(),
      expandedContext: new Map(),
      expandedLargeDiffs: new Set(),
      files: [file(path)],
      pendingComment: null,
      showCommentInput: false,
      viewedFiles: new Map(),
      ...emptyFns,
    });
    const diffLines = items.filter((item) => item.type === "diff-line");
    expect(diffLines).toHaveLength(3);
    expect(maps.searchIdToIndex.get(`${path}:0:1`)).toBeDefined();
    expect(items[0]).toMatchObject({
      type: "file-header",
      completeCard: false,
    });
    expect(items.at(-1)).toMatchObject({ type: "file-end" });
  });

  it("does not emit an after expansion control after reaching end of file", () => {
    const path = "a.ts";
    const { items } = buildDiffVirtuosoItems({
      actualConflictedFiles: [],
      allFileHunks: hunks(path, ["+one"]),
      collapsedFiles: new Set(),
      committedFileHunks: new Map(),
      committedFiles: [],
      conflictLineLookups: new Map(),
      expandedContext: new Map([[`${path}:0:after`, []]]),
      expandedLargeDiffs: new Set(),
      files: [file(path)],
      pendingComment: null,
      showCommentInput: false,
      viewedFiles: new Map(),
      ...emptyFns,
    });

    expect(items.some((item) => item.type === "expand-after")).toBe(false);
  });

  it("emits a large-diff placeholder instead of lines when not expanded", () => {
    const path = "big.ts";
    const lines = Array.from({ length: 251 }, (_, i) => `+line ${i}`);
    const { items } = buildDiffVirtuosoItems({
      actualConflictedFiles: [],
      allFileHunks: hunks(path, lines),
      collapsedFiles: new Set(),
      committedFileHunks: new Map(),
      committedFiles: [],
      conflictLineLookups: new Map(),
      expandedContext: new Map(),
      expandedLargeDiffs: new Set(),
      files: [file(path)],
      pendingComment: null,
      showCommentInput: false,
      viewedFiles: new Map(),
      ...emptyFns,
    });
    expect(items.some((item) => item.type === "diff-line")).toBe(false);
    expect(items.some((item) => item.type === "file-placeholder")).toBe(true);
  });
});
