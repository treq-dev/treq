import { describe, expect, it, vi } from "vitest";
import { render, screen } from "../../../test/test-utils";
import type { DiffContentAreaProps } from "./DiffContentArea";
import { DiffVirtuosoList } from "./DiffVirtuoso";

vi.mock("./useDiffVirtuosoItems", () => ({
  useDiffVirtuosoItems: () => ({
    items: [
      { type: "test", key: "first" },
      { type: "test", key: "second" },
    ],
    maps: { filePathToIndex: new Map(), searchIdToIndex: new Map() },
  }),
}));

vi.mock("./DiffVirtuosoRow", () => ({
  DiffVirtuosoRow: ({ item }: { item: { key: string } }) => (
    <div>{item.key}</div>
  ),
}));

describe("DiffVirtuosoList", () => {
  it("mounts every diff row without waiting for its scroll position", () => {
    const scrollerRef = { current: null };
    render(
      <DiffVirtuosoList
        props={
          {
            actualConflictedFiles: [],
            files: [],
            committedFiles: [],
            showCommittedChanges: false,
          } as unknown as DiffContentAreaProps
        }
        scrollerRef={scrollerRef}
      />,
    );

    expect(screen.getByText("first")).toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
  });
});
