/**
 * Verifies that a failed gh action in the GitHub panel's PR detail pane
 * (here, Close PR) reports the gh error as a toast instead of silently
 * resetting the button.
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

const PR: GhPullRequest = {
  number: 42,
  title: "Close me",
  state: "OPEN",
  url: "https://github.com/acme/treq/pull/42",
  body: null,
  author: { login: "octocat", avatar_url: null },
  labels: [],
  head_ref_name: "feat/pr-42",
  base_ref_name: "main",
  merge_state_status: "CLEAN",
  created_at: "2026-07-20T10:00:00Z",
  updated_at: "2026-07-20T10:00:00Z",
  comments: [],
  is_draft: false,
};

it("shows an error toast when Close PR fails", async () => {
  const { repoPath } = createTestRepo(false);
  api.getGitRemoteUrl.mockResolvedValue({
    owner: "acme",
    repo: "treq",
    full_name: "acme/treq",
  });
  api.getPrChecksForPr.mockResolvedValue(null);
  api.ghListPrs.mockResolvedValue({ items: [PR], hasMore: false });
  api.ghViewPr.mockResolvedValue(PR);
  api.ghClosePr.mockRejectedValue(
    "gh: GraphQL: Resource not accessible by integration (closePullRequest)",
  );

  const user = userEvent.setup();
  render(<GitHubPanel repoPath={repoPath} onOpenSettings={vi.fn()} />);
  await user.click(await screen.findByRole("tab", { name: /pull requests/i }));
  await user.click(await screen.findByRole("button", { name: /close me/i }));
  await user.click(await screen.findByRole("button", { name: /close pr/i }));

  expect(await screen.findByText("Failed to close pull request")).toBeVisible();
  expect(screen.getByRole("button", { name: /close pr/i })).toBeEnabled();

  await captureDocument(document, {
    name: "github-action-error-toast-01-close-failed",
    expectations: [
      'An error toast with a red alert icon reads "Failed to close pull request" with the gh "Resource not accessible by integration" message beneath it.',
      "The PR detail still shows the PR as Open with an enabled Close PR button.",
    ],
  });
}, 60000);
