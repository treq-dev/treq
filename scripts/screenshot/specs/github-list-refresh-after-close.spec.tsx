/**
 * Verifies that closing a PR from the GitHub panel's detail pane refreshes
 * the paged "Open" PR list, so the closed PR drops out of it.
 */

import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { GitHubPanel } from "../../../src/components/GitHubPanel";
import type { GhPullRequest } from "../../../src/lib/api-types";
import { render, screen, waitFor } from "../../../test/test-utils";
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

it("refreshes the Open PR list after closing a PR", async () => {
  const { repoPath } = createTestRepo(false);
  let closed = false;
  api.getGitRemoteUrl.mockResolvedValue({
    owner: "acme",
    repo: "treq",
    full_name: "acme/treq",
  });
  api.getPrChecksForPr.mockResolvedValue(null);
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
  await user.click(await screen.findByRole("button", { name: /close me/i }));

  await captureDocument(document, {
    name: "github-list-refresh-after-close-01-before",
    expectations: [
      'The Open list shows both "Close me #42" and "Keep me open #7".',
      "The detail pane shows PR #42 as Open with a Close PR button.",
    ],
  });

  await user.click(await screen.findByRole("button", { name: /close pr/i }));
  await screen.findByRole("button", { name: /reopen pr/i });
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: /close me/i }),
    ).not.toBeInTheDocument(),
  );

  await captureDocument(document, {
    name: "github-list-refresh-after-close-02-after",
    expectations: [
      "The detail pane shows PR #42 as Closed with a Reopen PR button.",
      'The Open list no longer lists "Close me"; only "Keep me open #7" remains.',
    ],
  });
}, 60000);
