// @include-parallel
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubPanel } from "../../src/components/GitHubPanel";
import { render, screen, waitFor, within } from "../test-utils";
import { createTestRepo } from "../utils";

const remoteInfo = vi.hoisted(() => ({
  data: { full_name: "acme/treq", owner: "acme", name: "treq" },
  isLoading: false,
}));

const api = vi.hoisted(() => ({
  ghListPrs: vi.fn(),
  getWorkspaces: vi.fn(),
  ghCreatePr: vi.fn(),
  pushWorkspaceToRemote: vi.fn(),
  listCachedPrStatuses: vi.fn(),
}));

vi.mock("../../src/hooks/useMergeQueueStatus", () => ({
  cachedPrStatusesKey: (repoPath: string) => ["cached-pr-statuses", repoPath],
  createPrMutationKey: (repoPath: string, id: number | null) => [
    "create-pr",
    repoPath,
    id,
  ],
  invalidatePrStatuses: vi.fn(),
  useGitRemoteInfo: () => remoteInfo,
  usePrChecksForPr: () => ({ data: null, isLoading: false }),
  useMergeQueueEnabled: () => ({ data: false, isLoading: false }),
  useDequeueBranches: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../../src/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/api")>()),
  ghListPrs: api.ghListPrs,
  getWorkspaces: api.getWorkspaces,
  ghCreatePr: api.ghCreatePr,
  pushWorkspaceToRemote: api.pushWorkspaceToRemote,
}));
vi.mock("../../src/lib/api-pr-status", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/api-pr-status")>()),
  listCachedPrStatuses: api.listCachedPrStatuses,
}));

function makePr(number: number, title = `PR ${number}`) {
  return {
    number,
    title,
    state: "OPEN",
    url: `https://github.com/acme/treq/pull/${number}`,
    body: null,
    author: { login: "alice" },
    labels: [] as { name: string; color: string }[],
    head_ref_name: `feat/${number}`,
    base_ref_name: "main",
    merge_state_status: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    comments: null,
  };
}

describe("GitHubPanel pull request list", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    window.location.hash = "#/github/prs/open";
    api.ghListPrs.mockReset();
    api.ghListPrs.mockResolvedValue({ items: [], hasMore: false });
    api.getWorkspaces.mockResolvedValue([]);
    api.ghCreatePr.mockReset();
    api.pushWorkspaceToRemote.mockReset();
    api.pushWorkspaceToRemote.mockResolvedValue(undefined);
    api.listCachedPrStatuses.mockResolvedValue({});
    user = userEvent.setup();
  });

  it("shows who opened each pull request on its second row", async () => {
    api.ghListPrs.mockResolvedValue({
      items: [{ ...makePr(1), author: { login: "octocat" } }],
      hasMore: false,
    });

    render(<GitHubPanel repoPath="/tmp/repo" />);

    const row = (await screen.findByText("PR 1")).closest("button")!;
    expect(within(row).getByText("octocat")).toBeVisible();
  });

  it("narrows the pull request list with the search bar", async () => {
    api.ghListPrs.mockResolvedValue({
      items: [makePr(1, "Fix login"), makePr(2, "Add billing")],
      hasMore: false,
    });

    render(<GitHubPanel repoPath="/tmp/repo" />);
    await screen.findByText("Fix login");

    await user.type(
      screen.getByRole("searchbox", { name: /search pull requests/i }),
      "billing",
    );

    expect(screen.getByText("Add billing")).toBeVisible();
    expect(screen.queryByText("Fix login")).not.toBeInTheDocument();
  });

  it("ANDs the author and label filters", async () => {
    api.ghListPrs.mockResolvedValue({
      items: [
        {
          ...makePr(1, "Alice bug"),
          labels: [{ name: "bug", color: "ff0000" }],
        },
        { ...makePr(2, "Alice feature") },
        {
          ...makePr(3, "Bob bug"),
          author: { login: "bob" },
          labels: [{ name: "bug", color: "ff0000" }],
        },
      ],
      hasMore: false,
    });

    render(<GitHubPanel repoPath="/tmp/repo" />);
    await screen.findByText("Alice bug");

    await user.click(screen.getByRole("button", { name: /^filters/i }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Author" }),
      "alice",
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Label" }),
      "bug",
    );

    expect(screen.getByText("Alice bug")).toBeVisible();
    expect(screen.queryByText("Alice feature")).not.toBeInTheDocument();
    expect(screen.queryByText("Bob bug")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^filters/i }));
    expect(
      screen.queryByRole("combobox", { name: "Author" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Bob bug")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^filters/i }));
    await user.click(
      await screen.findByRole("button", { name: /clear filters/i }),
    );
    expect(screen.getByText("Bob bug")).toBeVisible();
  });

  it("filters pull requests by stack level", async () => {
    api.ghListPrs.mockResolvedValue({
      items: [
        { ...makePr(1, "Bottom"), head_ref_name: "a" },
        { ...makePr(2, "Top"), head_ref_name: "b", base_ref_name: "a" },
      ],
      hasMore: false,
    });

    render(<GitHubPanel repoPath="/tmp/repo" />);
    await screen.findByText("Bottom");

    await user.click(screen.getByRole("button", { name: /^filters/i }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Stack level" }),
      "2",
    );

    expect(screen.getByText("Top")).toBeVisible();
    expect(screen.queryByText("Bottom")).not.toBeInTheDocument();
  });

  it("opens new pull requests in a modal with workspace and branch tabs", async () => {
    render(<GitHubPanel repoPath="/tmp/repo" />);
    await user.click(screen.getByRole("button", { name: /new/i }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("tab", { name: /from workspace/i }),
    ).toHaveAttribute("aria-selected", "true");
    await user.click(within(dialog).getByRole("tab", { name: /from branch/i }));
    expect(within(dialog).getByPlaceholderText("Head branch")).toBeVisible();

    await user.click(within(dialog).getByRole("button", { name: /cancel/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers only workspaces without an open pull request and creates one", async () => {
    const workspace = (id: number, branch: string, title: string) => ({
      id,
      repo_path: "/tmp/repo",
      workspace_name: branch,
      workspace_path: `/tmp/ws/${id}`,
      branch_name: branch,
      created_at: "2026-01-01T00:00:00Z",
      target_branch: "main",
      title,
      description: "Body text",
      not_on_remote: true,
    });
    api.getWorkspaces.mockResolvedValue([
      workspace(1, "feat/has-pr", "Has PR"),
      workspace(2, "feat/closed-pr", "Closed PR"),
      workspace(3, "feat/no-pr", "No PR yet"),
    ]);
    api.listCachedPrStatuses.mockResolvedValue({
      "feat/has-pr": { number: 5, state: "OPEN" },
      "feat/closed-pr": { number: 6, state: "CLOSED" },
    });
    api.ghCreatePr.mockResolvedValue(42);

    render(<GitHubPanel repoPath="/tmp/repo" />);
    await user.click(screen.getByRole("button", { name: /new/i }));
    const dialog = await screen.findByRole("dialog");

    await user.click(
      await within(dialog).findByRole("radio", { name: /no pr yet/i }),
    );
    expect(
      within(dialog).getByRole("radio", { name: /closed pr/i }),
    ).toBeVisible();
    expect(
      within(dialog).queryByRole("radio", { name: /has pr/i }),
    ).not.toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: /create pull request/i }),
    );

    await waitFor(() =>
      expect(api.ghCreatePr).toHaveBeenCalledWith(
        "acme/treq",
        expect.any(String),
        "Body text",
        "main",
        "feat/no-pr",
        false,
      ),
    );
    expect(api.pushWorkspaceToRemote).toHaveBeenCalledWith("/tmp/repo", 3);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("prefills the new pull request base with the repo default branch", async () => {
    const { repoPath, defaultBranch } = createTestRepo(false);
    expect(defaultBranch).not.toBe("main");

    render(<GitHubPanel repoPath={repoPath} />);
    await user.click(screen.getByRole("button", { name: /new/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("tab", { name: /from branch/i }));

    const base = screen.getByPlaceholderText("Base branch");
    await waitFor(() => expect(base).toHaveValue(defaultBranch));

    await user.clear(base);
    await user.type(base, "release");
    expect(base).toHaveValue("release");
  });
});
