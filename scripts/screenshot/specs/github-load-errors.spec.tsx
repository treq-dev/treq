/**
 * Verifies that gh load failures in the GitHub panel show the gh message:
 * a failed PR list shows an error with Try again (not "No pull requests
 * found."), retrying recovers the list, and a PR that fails to load shows
 * an error in the detail pane instead of a blank panel.
 */

import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { GitHubPanel } from "../../../src/components/GitHubPanel";
import type { GhPullRequest } from "../../../src/lib/api-types";
import { render, screen } from "../../../test/test-utils";
import { createTestRepo } from "../../../test/utils";
import { captureDocument } from "../capture";

const api = vi.hoisted(() => ({
  getGitRemoteUrl: vi.fn(),
  ghListPrs: vi.fn(),
  ghViewPr: vi.fn(),
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
    getPrChecksForPr: api.getPrChecksForPr,
  };
});

const GONE_PR: GhPullRequest = {
  number: 404,
  title: "Deleted PR",
  state: "OPEN",
  url: "https://github.com/acme/treq/pull/404",
  body: null,
  author: { login: "octocat", avatar_url: null },
  labels: [],
  head_ref_name: "feat/gone",
  base_ref_name: "main",
  merge_state_status: "CLEAN",
  created_at: "2026-07-20T10:00:00Z",
  updated_at: "2026-07-20T10:00:00Z",
  comments: [],
  is_draft: false,
};

it("shows gh load errors in the PR list and PR detail", async () => {
  const { repoPath } = createTestRepo(false);
  api.getGitRemoteUrl.mockResolvedValue({
    owner: "acme",
    repo: "treq",
    full_name: "acme/treq",
  });
  api.getPrChecksForPr.mockResolvedValue(null);
  api.ghListPrs
    .mockRejectedValueOnce(
      "gh: You are not logged into any GitHub hosts. Run gh auth login.",
    )
    .mockResolvedValue({ items: [GONE_PR], hasMore: false });
  api.ghViewPr.mockRejectedValue(
    "gh: GraphQL: Could not resolve to a PullRequest with the number of 404.",
  );

  const user = userEvent.setup();
  render(<GitHubPanel repoPath={repoPath} onOpenSettings={vi.fn()} />);
  await user.click(await screen.findByRole("tab", { name: /pull requests/i }));

  expect(await screen.findByText("Could not load pull requests")).toBeVisible();
  expect(screen.getByRole("button", { name: /try again/i })).toBeVisible();

  await captureDocument(document, {
    name: "github-load-errors-01-list-failed",
    expectations: [
      'The PR list shows a red alert icon, "Could not load pull requests", and the gh "not logged into any GitHub hosts" message.',
      'A "Try again" button sits under the message, and "No pull requests found." is not shown.',
    ],
  });

  await user.click(screen.getByRole("button", { name: /try again/i }));
  await user.click(await screen.findByRole("button", { name: /deleted pr/i }));
  expect(
    await screen.findByText("Could not load pull request #404"),
  ).toBeVisible();

  await captureDocument(document, {
    name: "github-load-errors-02-detail-failed",
    expectations: [
      'The detail pane on the right shows "Could not load pull request #404" with the gh "Could not resolve to a PullRequest" message, not a blank panel.',
    ],
  });
}, 60000);
