import userEvent from "@testing-library/user-event";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubPanel } from "../../src/components/GitHubPanel";
import { render, screen, waitFor, within } from "../test-utils";

const api = vi.hoisted(() => ({
  ghListIssues: vi.fn(),
  ghListPrs: vi.fn(),
  ghViewIssue: vi.fn(),
  ghDeleteIssue: vi.fn(),
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

function makeIssue(number: number, title: string) {
  return {
    number,
    title,
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

describe("GitHubPanel delete issue", () => {
  let user: ReturnType<typeof userEvent.setup>;
  let deleted: boolean;

  beforeEach(() => {
    window.location.hash = "";
    user = userEvent.setup();
    deleted = false;
    for (const fn of Object.values(api)) fn.mockReset();
    api.ghListIssues.mockImplementation(async () => ({
      items: deleted
        ? [makeIssue(7, "Keep me")]
        : [makeIssue(42, "Delete me"), makeIssue(7, "Keep me")],
      hasMore: false,
    }));
    api.ghListPrs.mockResolvedValue({ items: [], hasMore: false });
    api.ghViewIssue.mockResolvedValue(makeIssue(42, "Delete me"));
    api.ghDeleteIssue.mockImplementation(async () => {
      deleted = true;
    });
    api.getWorkspaces.mockResolvedValue([]);
  });

  async function openIssueAndAskToDelete() {
    render(<GitHubPanel repoPath="/tmp/repo" />);
    await user.click(await screen.findByRole("button", { name: /delete me/i }));
    await user.click(
      await screen.findByRole("button", { name: /delete issue/i }),
    );
    return screen.findByRole("dialog");
  }

  it("deletes the issue after confirmation and returns to the list", async () => {
    const dialog = await openIssueAndAskToDelete();
    expect(within(dialog).getByText(/delete issue #42\?/i)).toBeVisible();

    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() =>
      expect(api.ghDeleteIssue).toHaveBeenCalledWith("acme/treq", 42),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Delete me" }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /delete me/i }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /keep me/i })).toBeVisible();
  });

  it("does nothing when the confirmation is cancelled", async () => {
    const dialog = await openIssueAndAskToDelete();

    await user.click(within(dialog).getByRole("button", { name: /cancel/i }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(api.ghDeleteIssue).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Delete me" })).toBeVisible();
  });

  it("keeps the issue open and shows the gh error when deleting fails", async () => {
    api.ghDeleteIssue.mockRejectedValue(
      "gh: HTTP 403: Must have admin rights to Repository.",
    );
    const dialog = await openIssueAndAskToDelete();

    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    expect(await screen.findByText("Failed to delete issue")).toBeVisible();
    expect(
      screen.getByText("gh: HTTP 403: Must have admin rights to Repository."),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "Delete me" })).toBeVisible();
  });
});
