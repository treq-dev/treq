// @include-parallel
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubPanel } from "../../src/components/GitHubPanel";
import { render, screen, waitFor } from "../test-utils";

const api = vi.hoisted(() => ({
  ghListIssues: vi.fn(),
  ghListPrs: vi.fn(),
  getWorkspaces: vi.fn(),
}));

vi.mock("../../src/hooks/useMergeQueueStatus", () => ({
  useGitRemoteInfo: () => ({
    data: { full_name: "acme/treq", owner: "acme", name: "treq" },
    isLoading: false,
  }),
  usePrChecksForPr: () => ({ data: null, isLoading: false }),
  useMergeQueueEnabled: () => ({ data: false, isLoading: false }),
  useSetMergeQueueEnabled: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDequeueBranches: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../../src/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/lib/api")>();
  return { ...original, ...api };
});

function makeIssue(number: number) {
  return {
    number,
    title: `Issue ${number}`,
    state: "OPEN",
    url: `https://github.com/acme/treq/issues/${number}`,
    body: null,
    author: { login: "alice" },
    labels: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    comments: null,
  };
}

describe("GitHubPanel issue pagination", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    window.location.hash = "";
    user = userEvent.setup();
    for (const fn of Object.values(api)) fn.mockReset();
    api.ghListPrs.mockResolvedValue({ items: [], hasMore: false });
    api.getWorkspaces.mockResolvedValue([]);
  });

  it("requests each page after the previous page's cursor", async () => {
    api.ghListIssues.mockImplementation(async (...args: unknown[]) =>
      args[3] === "cursor-2"
        ? { items: [makeIssue(1)], hasMore: false, endCursor: "cursor-3" }
        : args[3] === "cursor-1"
          ? {
              items: [makeIssue(3), makeIssue(2)],
              hasMore: true,
              endCursor: "cursor-2",
            }
          : {
              items: [makeIssue(5), makeIssue(4)],
              hasMore: true,
              endCursor: "cursor-1",
            },
    );

    render(<GitHubPanel repoPath="/tmp/repo" />);
    await screen.findByText("Issue 5");
    await user.click(screen.getByRole("button", { name: /load more/i }));
    await screen.findByText("Issue 3");
    await user.click(screen.getByRole("button", { name: /load more/i }));

    expect(await screen.findByText("Issue 1")).toBeVisible();
    expect(api.ghListIssues.mock.calls.map((call) => call[3] ?? null)).toEqual([
      null,
      "cursor-1",
      "cursor-2",
    ]);
    expect(
      screen.queryByRole("button", { name: /load more/i }),
    ).not.toBeInTheDocument();
  });

  it("lists an issue once when two pages both return it", async () => {
    api.ghListIssues.mockImplementation(async (...args: unknown[]) =>
      args[3] === "cursor-1"
        ? {
            items: [makeIssue(2), makeIssue(1)],
            hasMore: false,
            endCursor: "cursor-2",
          }
        : {
            items: [makeIssue(3), makeIssue(2)],
            hasMore: true,
            endCursor: "cursor-1",
          },
    );

    render(<GitHubPanel repoPath="/tmp/repo" />);
    await screen.findByText("Issue 3");
    await user.click(screen.getByRole("button", { name: /load more/i }));

    expect(await screen.findByText("Issue 1")).toBeVisible();
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /issue 2/i })).toHaveLength(
        1,
      ),
    );
    const titles = screen
      .getAllByRole("button", { name: /^issue \d/i })
      .map((b) => b.textContent);
    expect(titles).toEqual([
      expect.stringContaining("Issue 3"),
      expect.stringContaining("Issue 2"),
      expect.stringContaining("Issue 1"),
    ]);
  });
});
