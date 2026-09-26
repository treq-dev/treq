import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ParsedFileChange } from "../../../lib/git-utils";
import type { FileHunksData } from "../types";
import { useReview } from "./useReview";

vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return {
    ...actual,
    loadPendingReview: vi.fn().mockResolvedValue(null),
    savePendingReview: vi.fn().mockResolvedValue(undefined),
    clearPendingReview: vi.fn().mockResolvedValue(undefined),
    markFileViewed: vi.fn().mockResolvedValue(undefined),
    unmarkFileViewed: vi.fn().mockResolvedValue(undefined),
  };
});

const FILE = "reviews-flow.txt";

const LOADED: FileHunksData = {
  filePath: FILE,
  isLoading: false,
  hunks: [
    {
      id: "h1",
      header: "@@ -0,0 +1,2 @@",
      lines: ["+first review line\n", "+second review line\n"],
      patch: "",
    },
  ],
};

function renderUseReview(allFileHunks: Map<string, FileHunksData>) {
  const files = [{ path: FILE }] as unknown as ParsedFileChange[];
  return renderHook(
    ({ hunks }: { hunks: Map<string, FileHunksData> }) =>
      useReview({
        comments: [],
        setComments: vi.fn(),
        conflictComments: new Map(),
        setConflictComments: vi.fn(),
        setHasUserAddedComments: vi.fn(),
        allFileHunks: hunks,
        setAllFileHunks: vi.fn(),
        files,
        workspacePath: "/tmp/ws",
        repoPath: undefined,
        workspaceId: undefined,
        conflictRegionsByFile: new Map(),
        actualConflictedFiles: [],
        setCollapsedFiles: vi.fn(),
        applyChangedFilesRef: { current: vi.fn() },
        isReloadingRef: { current: false },
        onCreateAgentWithReview: undefined,
        onReviewSubmitted: undefined,
        addToast: vi.fn(),
      }),
    { initialProps: { hunks: allFileHunks } },
  );
}

describe("useReview viewed files", () => {
  it("keeps a file viewed when it was marked before its diff finished loading", async () => {
    const loading = new Map<string, FileHunksData>([
      [FILE, { filePath: FILE, hunks: [], isLoading: true }],
    ]);
    const { result, rerender } = renderUseReview(loading);

    await act(async () => {
      await result.current.handleMarkFileViewed(FILE);
    });
    expect(result.current.viewedFiles.has(FILE)).toBe(true);

    rerender({ hunks: new Map([[FILE, LOADED]]) });

    expect(result.current.viewedFiles.has(FILE)).toBe(true);
  });

  it("still un-marks a viewed file whose loaded diff changes", async () => {
    const { result, rerender } = renderUseReview(new Map([[FILE, LOADED]]));

    await act(async () => {
      await result.current.handleMarkFileViewed(FILE);
    });
    expect(result.current.viewedFiles.has(FILE)).toBe(true);

    rerender({
      hunks: new Map([
        [
          FILE,
          {
            ...LOADED,
            hunks: [{ ...LOADED.hunks[0], lines: ["+changed line\n"] }],
          },
        ],
      ]),
    });

    expect(result.current.viewedFiles.has(FILE)).toBe(false);
  });
});
