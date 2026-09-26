/**
 * Review of the GitHub panel's write flows: after closing a PR from the
 * detail pane, the "Open" PR list should drop it; when gh fails (close or
 * list), the panel should say so instead of looking like nothing happened.
 */

import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { GitHubPanel } from "../../../src/components/GitHubPanel";
import type { GhPullRequest } from "../../../src/lib/api-types";
import { render, screen, waitFor, within } from "../../../test/test-utils";
import { createTestRepo } from "../../../test/utils";
import { captureDocument } from "../capture";

const api = vi.hoisted(() => ({
  getGitRemoteUrl: vi.fn(),
  ghListPrs: vi.fn(),
  ghViewPr: vi.fn(),
  ghClosePr: vi.fn(),
  getPrChecksForPr: vi.fn(),
}));

vi.mock("../../../src/lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../../src/lib/api")>(
    "../../../src/lib/api",
  );
  return {
    ...actual,
    getGitRemoteUrl: api.getGitRemoteUrl,
    ghListIssues: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
    ghListPrs: api.ghListPrs,
    ghViewPr: api.ghViewPr,
    ghClosePr: api.ghClosePr,
    getPrChecksForPr: api.getPrChecksForPr,
  };
});

const REMOTE_INFO = { owner: "acme", repo: "treq", full_name: "acme/treq" };

function pr(number: number, title: string, state = "OPEN"): GhPullRequest {
  return {
    number,
    title,
    state,
    url: `https://github.com/acme/treq/pull/${number}`,
    body: null,
    author: { login: "octocat", avatar_url: null },
    labels: [],
    head_ref_name: `feat/pr-${number}`,
    base_ref_name: "main",
    merge_state_status: "CLEAN",
    created_at: "2026-07-20T10:00:00Z",
    updated_at: "2026-07-20T10:00:00Z",
    comments: [],
    is_draft: false,
  };
}

function resetMocks() {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getGitRemoteUrl.mockResolvedValue(REMOTE_INFO);
  api.getPrChecksForPr.mockResolvedValue(null);
}

it("refreshes the Open PR list after closing a PR", async () => {
  resetMocks();
  const { repoPath } = createTestRepo(false);
  let closed = false;
  api.ghListPrs.mockImplementation(async () => ({
    items: closed
      ? [pr(7, "Keep me open")]
      : [pr(42, "Close me"), pr(7, "Keep me open")],
    hasMore: false,
  }));
  api.ghViewPr.mockImplementation(async (_: string, n: number) =>
    n === 42
      ? pr(42, "Close me", closed ? "CLOSED" : "OPEN")
      : pr(7, "Keep me open"),
  );
  api.ghClosePr.mockImplementation(async () => {
    closed = true;
  });

  const user = userEvent.setup();
  render(<GitHubPanel repoPath={repoPath} onOpenSettings={vi.fn()} />);
  await user.click(await screen.findByRole("tab", { name: /pull requests/i }));
  await user.click(await screen.findByText("Close me"));
  await user.click(await screen.findByRole("button", { name: /close pr/i }));
  await screen.findByRole("button", { name: /reopen pr/i });
  // Give any list revalidation a chance to land before judging it.
  await new Promise((r) => setTimeout(r, 500));

  await captureDocument(document, {
    name: "github-panel-mutation-feedback-01-after-close",
    expectations: [
      "The detail pane shows PR #42 as Closed with a Reopen PR button.",
      'The left list is filtered to "Open" and no longer lists "Close me"; only "Keep me open" remains.',
    ],
  });
  console.log(
    `[review] ghListPrs calls after close: ${api.ghListPrs.mock.calls.length}`,
  );
  expect(api.ghClosePr).toHaveBeenCalledTimes(1);
}, 60000);

it("surfaces a failed Close PR", async () => {
  resetMocks();
  const { repoPath } = createTestRepo(false);
  api.ghListPrs.mockResolvedValue({
    items: [pr(42, "Close me")],
    hasMore: false,
  });
  api.ghViewPr.mockResolvedValue(pr(42, "Close me"));
  api.ghClosePr.mockRejectedValue(
    "gh: GraphQL: Resource not accessible by integration (closePullRequest)",
  );

  const user = userEvent.setup();
  render(<GitHubPanel repoPath={repoPath} onOpenSettings={vi.fn()} />);
  await user.click(await screen.findByRole("tab", { name: /pull requests/i }));
  await user.click(await screen.findByText("Close me"));
  await user.click(await screen.findByRole("button", { name: /close pr/i }));
  await waitFor(() => expect(api.ghClosePr).toHaveBeenCalled());
  await screen.findByRole("button", { name: /close pr/i });

  await captureDocument(document, {
    name: "github-panel-mutation-feedback-02-close-failed",
    expectations: [
      "After a failed close, the detail pane shows an error message explaining the gh failure (toast or inline).",
    ],
  });
}, 60000);

it("surfaces a failed PR list fetch", async () => {
  resetMocks();
  const { repoPath } = createTestRepo(false);
  api.ghListPrs.mockRejectedValue(
    "gh auth: You are not logged into any GitHub hosts. Run gh auth login.",
  );

  const user = userEvent.setup();
  render(<GitHubPanel repoPath={repoPath} onOpenSettings={vi.fn()} />);
  await user.click(await screen.findByRole("tab", { name: /pull requests/i }));
  await waitFor(() => expect(api.ghListPrs).toHaveBeenCalled());
  const panel = await screen.findByTestId("github-panel");
  await waitFor(() => expect(within(panel).queryByRole("status")).toBeNull());
  await new Promise((r) => setTimeout(r, 300));

  await captureDocument(document, {
    name: "github-panel-mutation-feedback-03-list-failed",
    expectations: [
      "The PR list shows the gh auth error (not a plain empty state), so the user knows to run gh auth login.",
    ],
  });
}, 60000);
