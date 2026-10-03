/**
 * Verifies the Pull Requests list shows each PR's author, narrows with the
 * search bar and AND-ed filters, and opens New in a two-tab modal.
 */

import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { GitHubPanel } from "../../../src/components/GitHubPanel";
import { createWorkspace } from "../../../src/lib/api";
import type { GhPullRequest } from "../../../src/lib/api-types";
import { render, screen, waitFor, within } from "../../../test/test-utils";
import { createTestRepo } from "../../../test/utils";
import { captureDocument } from "../capture";

const { mockGetGitRemoteUrl, mockGhListPrs, mockListCachedPrStatuses } =
  vi.hoisted(() => ({
    mockGetGitRemoteUrl: vi.fn(),
    mockGhListPrs: vi.fn(),
    mockListCachedPrStatuses: vi.fn(),
  }));

// The shared test mock renders popovers in-tree, where the list pane clips them.
vi.unmock("../../../src/components/ui/popover");

vi.mock("../../../src/lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../../src/lib/api")>(
    "../../../src/lib/api",
  );
  return {
    ...actual,
    getGitRemoteUrl: mockGetGitRemoteUrl,
    ghListIssues: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
    ghListPrs: mockGhListPrs,
  };
});
vi.mock("../../../src/lib/api-pr-status", async () => ({
  ...(await vi.importActual<typeof import("../../../src/lib/api-pr-status")>(
    "../../../src/lib/api-pr-status",
  )),
  listCachedPrStatuses: mockListCachedPrStatuses,
}));

function makePr(
  number: number,
  title: string,
  overrides: Partial<GhPullRequest>,
): GhPullRequest {
  return {
    number,
    title,
    state: "OPEN",
    url: `https://github.com/treq-dev/treq/pull/${number}`,
    body: null,
    author: { login: "octocat", avatar_url: null },
    labels: [],
    head_ref_name: `feat/${number}`,
    base_ref_name: "main",
    merge_state_status: "CLEAN",
    created_at: "2026-07-20T10:00:00Z",
    updated_at: "2026-07-20T10:00:00Z",
    comments: [],
    ...overrides,
  };
}

const BUG = { name: "bug", color: "d73a4a" };
const PRS = [
  makePr(11, "Fix login redirect", { labels: [BUG], head_ref_name: "fix/login" }),
  makePr(12, "Stack: login tests", {
    author: { login: "hubot", avatar_url: null },
    head_ref_name: "fix/login-tests",
    base_ref_name: "fix/login",
  }),
  makePr(13, "Billing page", {
    author: { login: "hubot", avatar_url: null },
    labels: [BUG],
    merge_state_status: "DIRTY",
  }),
];

it("shows authors, filters the PR list, and opens New in a modal", async () => {
  const { repoPath } = createTestRepo(false);
  await createWorkspace(repoPath, "feat/has-open-pr");
  await createWorkspace(repoPath, "feat/ready-for-pr");

  mockGetGitRemoteUrl.mockResolvedValue({
    owner: "treq-dev",
    repo: "treq",
    full_name: "treq-dev/treq",
  });
  mockGhListPrs.mockResolvedValue({ items: PRS, hasMore: false });
  mockListCachedPrStatuses.mockResolvedValue({
    "feat/has-open-pr": { number: 9, state: "OPEN" },
  });

  const user = userEvent.setup();
  render(<GitHubPanel repoPath={repoPath} onOpenSettings={vi.fn()} />);
  await user.click(await screen.findByRole("tab", { name: /pull requests/i }));
  await screen.findByText("Billing page");

  await captureDocument(document, {
    name: "github-pr-list-filters-01-authors",
    expectations: [
      "Each PR row's second line shows the author login (octocat or hubot) after the state chip.",
      "Draft/Open/Closed/All, a Filters button, then a ~20rem search box (same height as Filters) share one row, with Refresh and New at the right.",
    ],
  });

  await user.click(screen.getByRole("button", { name: /^filters/i }));
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Author" }),
    "hubot",
  );
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Label" }),
    "bug",
  );
  expect(screen.queryByText("Fix login redirect")).not.toBeInTheDocument();
  expect(screen.queryByText("Stack: login tests")).not.toBeInTheDocument();

  await captureDocument(document, {
    name: "github-pr-list-filters-02-filtered",
    expectations: [
      "A floating popover card shows two columns of dropdowns: Author, Label, Source/Target branch, Stack level, Opened, Merge conflicts (jsdom has no layout, so it sits at the top-left).",
      'Author is "hubot" and Label is "bug"; the Filters button shows a badge with 2.',
      'Only "Billing page" is listed.',
    ],
  });

  await user.click(screen.getByRole("button", { name: /clear filters/i }));
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(
      screen.queryByRole("combobox", { name: "Author" }),
    ).not.toBeInTheDocument(),
  );
  await user.type(
    screen.getByRole("searchbox", { name: /search pull requests/i }),
    "login",
  );
  expect(screen.queryByText("Billing page")).not.toBeInTheDocument();

  await captureDocument(document, {
    name: "github-pr-list-filters-03-search",
    expectations: [
      'The search box contains "login".',
      'Only "Fix login redirect" and "Stack: login tests" are listed.',
    ],
  });

  await user.click(screen.getByRole("button", { name: /new/i }));
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByRole("radio", { name: /ready-for-pr/i });
  expect(
    within(dialog).queryByRole("radio", { name: /has-open-pr/i }),
  ).not.toBeInTheDocument();
  await user.click(
    within(dialog).getByRole("radio", { name: /ready-for-pr/i }),
  );

  await captureDocument(document, {
    name: "github-pr-list-filters-04-new-from-workspace",
    expectations: [
      'A centered "New Pull Request" modal with tabs "From workspace" (selected) and "From branch".',
      'The workspace list shows feat/ready-for-pr (highlighted) but not feat/has-open-pr.',
      "Below the list: prefilled Title, Base branch, Description, and a Create Pull Request split button with Cancel.",
    ],
  });

  await user.click(within(dialog).getByRole("tab", { name: /from branch/i }));
  await within(dialog).findByPlaceholderText("Head branch");

  await captureDocument(document, {
    name: "github-pr-list-filters-05-new-from-branch",
    expectations: [
      '"From branch" is the selected tab in the modal.',
      "The modal shows the Title, Head branch → Base branch, Description form with Create Pull Request and Cancel.",
    ],
  });
}, 60000);
