import fs from "node:fs";
import path from "node:path";
import { openUrl } from "@tauri-apps/plugin-opener";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "../../../src/components/Dashboard";
import {
  createWorkspace,
  getCachedPrInfo,
  getWorkspaces,
  ghCreatePr,
  ghViewPr,
  getPrInfoViaGh,
  pushWorkspaceToRemote,
  updateWorkspace,
} from "../../../src/lib/api";
import { render, screen, waitFor, within } from "../../test-utils";
import {
  commitWorkspaceFile,
  createTestRepo,
  findSidebarBranchElement,
  openRepo,
  resolveWorkspacePath,
  writeWorkspaceFile,
} from "../../utils";
import { deriveConventionalPrTitle } from "../../../src/lib/github-pr";

vi.mock("../../../src/lib/api", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../src/lib/api")>();
  return {
    ...original,
    getCachedPrInfo: vi.fn().mockResolvedValue(null),
    getPrInfoViaGh: vi.fn().mockResolvedValue(null),
    startPrStatusPolling: vi.fn(async () => undefined),
    stopPrStatusPolling: vi.fn(async () => undefined),
    refreshPrStatuses: vi.fn(async () => undefined),
    getPrChecksForPr: vi.fn().mockResolvedValue(null),
    ghCreatePr: vi.fn().mockResolvedValue(42),
    ghViewPr: vi.fn(),
    ghListPrs: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
    ghListIssues: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
    pushWorkspaceToRemote: vi.fn(
      (repoPath: string, workspaceId: number | null) =>
        original.pushWorkspaceToRemote(repoPath, workspaceId),
    ),
  };
});

function setOriginUrl(repoPath: string, remoteUrl: string) {
  const configPath = path.join(repoPath, ".git", "config");
  let config = fs.readFileSync(configPath, "utf-8");
  if (/\[remote "origin"\][\s\S]*?url\s*=/.test(config)) {
    config = config.replace(
      /(\[remote "origin"\][\s\S]*?url\s*=\s*).*/m,
      `$1${remoteUrl}`,
    );
  } else {
    config += `\n[remote "origin"]\n\turl = ${remoteUrl}\n`;
  }
  fs.writeFileSync(configPath, config);
}

describe("ShowWorkspace - Create PR", () => {
  let repoPath: string;
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    ({ repoPath } = createTestRepo(true));
    openRepo(repoPath);
    user = userEvent.setup();
    vi.mocked(getCachedPrInfo).mockReset().mockResolvedValue(null);
    vi.mocked(getPrInfoViaGh).mockReset().mockResolvedValue(null);
    vi.mocked(ghCreatePr).mockReset().mockResolvedValue(42);
    vi.mocked(openUrl).mockReset();
  });

  async function setupPushedWorkspaceWithGitHub(options?: {
    title?: string;
    description?: string;
    githubRemote?: boolean;
  }) {
    const title = options?.title ?? "Ship the feature";
    const description =
      options?.description ?? "Implements the feature end-to-end.";
    const workspaceId = await createWorkspace(repoPath, "feat/create-pr");
    await updateWorkspace(repoPath, workspaceId, undefined, title, description);
    const created = (await getWorkspaces(repoPath)).find(
      (w) => w.id === workspaceId,
    )!;
    await commitWorkspaceFile(
      repoPath,
      { id: created.id, path: created.workspace_path },
      "feature.txt",
      "feature content",
      "Add feature",
    );
    await pushWorkspaceToRemote(repoPath, workspaceId);

    if (options?.githubRemote !== false) {
      setOriginUrl(repoPath, "https://github.com/acme/treq.git");
    }

    const workspace = (await getWorkspaces(repoPath)).find(
      (w) => w.branch_name === "feat/create-pr",
    );
    expect(workspace?.not_on_remote).toBe(false);
    return { workspace: workspace!, title, description };
  }

  async function openWorkspace(branchName: string) {
    await user.click(await findSidebarBranchElement(branchName));
    return screen.findByTestId("show-workspace-header");
  }

  async function findEnabledCreatePr(header: HTMLElement) {
    const createPr = await within(header).findByRole("button", {
      name: /^create pr$/i,
    });
    await waitFor(() => {
      expect(createPr).toBeEnabled();
    });
    return createPr;
  }

  it("shows Create PR instead of Push after the branch is on remote with GitHub", async () => {
    await setupPushedWorkspaceWithGitHub();
    render(<Dashboard />);

    const header = await openWorkspace("feat/create-pr");

    expect(
      await within(header).findByRole("button", { name: /^create pr$/i }),
    ).toBeVisible();
    expect(
      within(header).queryByRole("button", { name: /push to remote/i }),
    ).not.toBeInTheDocument();
  });

  it("styles Create PR controls with a dark-mode border", async () => {
    await setupPushedWorkspaceWithGitHub();
    render(<Dashboard />);

    const header = await openWorkspace("feat/create-pr");
    const createPr = await within(header).findByRole("button", {
      name: /^create pr$/i,
    });
    const moreOptions = await within(header).findByRole("button", {
      name: /more create pr options/i,
    });

    expect(createPr).toHaveClass("dark:border-white/30");
    expect(moreOptions).toHaveClass("dark:border-white/30");
    expect(moreOptions).toHaveAttribute("aria-label", "More Create PR options");
  });

  it("shows Create PR instead of Push to remote when a GitHub remote is configured", async () => {
    await createWorkspace(repoPath, "feat/unpushed");
    setOriginUrl(repoPath, "https://github.com/acme/treq.git");
    render(<Dashboard />);

    const header = await openWorkspace("feat/unpushed");

    expect(
      await within(header).findByRole("button", { name: /^create pr$/i }),
    ).toBeVisible();
    expect(
      within(header).queryByRole("button", { name: /push to remote/i }),
    ).not.toBeInTheDocument();
  });

  it("disables Create PR until the workspace has a real commit, not just working-copy changes", async () => {
    await createWorkspace(repoPath, "feat/no-commits");
    setOriginUrl(repoPath, "https://github.com/acme/treq.git");
    const view = render(<Dashboard />);

    const header = await openWorkspace("feat/no-commits");
    const createPr = await within(header).findByRole("button", {
      name: /^create pr$/i,
    });
    expect(createPr).toBeDisabled();
    expect(
      within(header).getByRole("button", { name: /more create pr options/i }),
    ).toBeDisabled();

    await user.click(createPr);
    expect(ghCreatePr).not.toHaveBeenCalled();

    view.unmount();

    const workspace = (await getWorkspaces(repoPath)).find(
      (w) => w.branch_name === "feat/no-commits",
    )!;
    await commitWorkspaceFile(
      repoPath,
      { id: workspace.id, path: workspace.workspace_path },
      "feature.txt",
      "feature content",
      "Add feature",
    );

    render(<Dashboard />);
    const reopenedHeader = await openWorkspace("feat/no-commits");
    await findEnabledCreatePr(reopenedHeader);
  });

  it("keeps Push to remote when the branch is not on remote and there's no GitHub remote", async () => {
    await createWorkspace(repoPath, "feat/unpushed");
    setOriginUrl(repoPath, "https://gitlab.com/acme/treq.git");
    render(<Dashboard />);

    const header = await openWorkspace("feat/unpushed");

    expect(
      await within(header).findByRole("button", { name: /push to remote/i }),
    ).toBeVisible();
    expect(
      within(header).queryByRole("button", { name: /^create pr$/i }),
    ).not.toBeInTheDocument();
  });

  it("pushes the branch then creates the PR in one click when it isn't on remote yet", async () => {
    const workspaceId = await createWorkspace(repoPath, "feat/unpushed");
    await updateWorkspace(
      repoPath,
      workspaceId,
      undefined,
      "Ship the feature",
      "Implements the feature end-to-end.",
    );
    const workspace = (await getWorkspaces(repoPath)).find(
      (w) => w.id === workspaceId,
    )!;
    await commitWorkspaceFile(
      repoPath,
      { id: workspace.id, path: workspace.workspace_path },
      "feature.txt",
      "feature content",
      "Add feature",
    );
    vi.mocked(pushWorkspaceToRemote).mockResolvedValueOnce("pushed");
    setOriginUrl(repoPath, "https://github.com/acme/treq.git");
    render(<Dashboard />);

    const header = await openWorkspace("feat/unpushed");
    await user.click(await findEnabledCreatePr(header));

    await waitFor(() => {
      expect(pushWorkspaceToRemote).toHaveBeenCalledWith(repoPath, workspaceId);
    });
    await waitFor(() => {
      expect(ghCreatePr).toHaveBeenCalledWith(
        "acme/treq",
        deriveConventionalPrTitle("Ship the feature", "feat/unpushed"),
        "Implements the feature end-to-end.",
        expect.any(String),
        "feat/unpushed",
        false,
      );
    });
  });

  it("pushes committed changes before creating a PR when the branch is ahead of remote", async () => {
    const { workspace } = await setupPushedWorkspaceWithGitHub();
    await commitWorkspaceFile(
      repoPath,
      { id: workspace.id, path: workspace.workspace_path },
      "follow-up.txt",
      "unpushed content",
      "Add unpushed follow-up",
    );
    vi.mocked(pushWorkspaceToRemote).mockClear();
    vi.mocked(pushWorkspaceToRemote).mockResolvedValueOnce("pushed");
    render(<Dashboard />);

    const header = await openWorkspace("feat/create-pr");
    await user.click(await findEnabledCreatePr(header));

    await waitFor(() => {
      expect(pushWorkspaceToRemote).toHaveBeenCalledWith(
        repoPath,
        workspace.id,
      );
    });
    await waitFor(() => {
      expect(ghCreatePr).toHaveBeenCalled();
    });
    expect(
      vi.mocked(pushWorkspaceToRemote).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(ghCreatePr).mock.invocationCallOrder[0]);
  });

  it("hides Create PR when there is no GitHub remote", async () => {
    await setupPushedWorkspaceWithGitHub({ githubRemote: false });
    render(<Dashboard />);

    const header = await openWorkspace("feat/create-pr");

    await waitFor(() => {
      expect(
        within(header).queryByRole("button", { name: /push to remote/i }),
      ).not.toBeInTheDocument();
    });
    expect(
      within(header).queryByRole("button", { name: /^create pr$/i }),
    ).not.toBeInTheDocument();
  });

  it("creates a PR with the workspace title and description", async () => {
    const { title, description } = await setupPushedWorkspaceWithGitHub();
    render(<Dashboard />);

    const header = await openWorkspace("feat/create-pr");
    await user.click(await findEnabledCreatePr(header));

    await waitFor(() => {
      expect(ghCreatePr).toHaveBeenCalledWith(
        "acme/treq",
        deriveConventionalPrTitle(title, "feat/create-pr"),
        description,
        expect.any(String),
        "feat/create-pr",
        false,
      );
    });

    await user.click(
      await screen.findByRole("button", { name: /open in web/i }),
    );
    expect(openUrl).toHaveBeenCalledWith(
      "https://github.com/acme/treq/pull/42",
    );
  });

  it("updates the header to View PR after committing and creating a PR", async () => {
    const workspaceId = await createWorkspace(repoPath, "feat/commit-create-pr");
    const workspace = (await getWorkspaces(repoPath)).find(
      (candidate) => candidate.id === workspaceId,
    )!;
    writeWorkspaceFile(
      resolveWorkspacePath(repoPath, workspace.workspace_path),
      "feature.txt",
      "feature content\n",
    );
    setOriginUrl(repoPath, "https://github.com/acme/treq.git");
    vi.mocked(pushWorkspaceToRemote).mockResolvedValueOnce("pushed");

    const createdPr = {
      number: 42,
      title: "Feature",
      state: "OPEN" as const,
      url: "https://github.com/acme/treq/pull/42",
      head_ref_name: "feat/commit-create-pr",
      base_ref_name: "main",
      merge_state_status: "CLEAN",
      is_draft: false,
    };
    vi.mocked(getPrInfoViaGh).mockImplementation(async () => {
      vi.mocked(getCachedPrInfo).mockResolvedValue(createdPr);
      return createdPr;
    });

    render(<Dashboard />);
    const header = await openWorkspace("feat/commit-create-pr");
    await user.click(await screen.findByRole("tab", { name: /changes/i }));
    await screen.findAllByText("feature.txt");
    await user.type(await screen.findByPlaceholderText("Message"), "Add feature");
    await user.click(screen.getByRole("button", { name: /more commit options/i }));
    const commitAndCreatePr = await screen.findByRole("menuitem", {
      name: /commit and create pr/i,
    });
    await waitFor(() => expect(commitAndCreatePr).toBeEnabled());
    await user.click(commitAndCreatePr);

    await waitFor(() => {
      expect(getPrInfoViaGh).toHaveBeenCalledWith(
        repoPath,
        "feat/commit-create-pr",
      );
    }, { timeout: 15_000 });
    expect(
      await within(header).findByRole("button", { name: /view pr.*open/i }),
    ).toBeVisible();
    expect(
      within(header).queryByRole("button", { name: /^create pr$/i }),
    ).not.toBeInTheDocument();
  }, 30_000);

  it("creates a draft PR from the dropdown", async () => {
    const { title, description } = await setupPushedWorkspaceWithGitHub();
    render(<Dashboard />);

    const header = await openWorkspace("feat/create-pr");
    await findEnabledCreatePr(header);
    await user.click(
      within(header).getByRole("button", { name: /more create pr options/i }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: /create draft pr/i }),
    );

    await waitFor(() => {
      expect(ghCreatePr).toHaveBeenCalledWith(
        "acme/treq",
        deriveConventionalPrTitle(title, "feat/create-pr"),
        description,
        expect.any(String),
        "feat/create-pr",
        true,
      );
    });
  });

  it("opens GitHub compare URL when creating a PR manually", async () => {
    await setupPushedWorkspaceWithGitHub();
    render(<Dashboard />);

    const header = await openWorkspace("feat/create-pr");
    await findEnabledCreatePr(header);
    await user.click(
      within(header).getByRole("button", { name: /more create pr options/i }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: /create pr manually/i }),
    );

    await waitFor(() => {
      expect(openUrl).toHaveBeenCalledWith(
        expect.stringContaining("https://github.com/acme/treq/compare/"),
      );
    });
    const url = vi.mocked(openUrl).mock.calls[0][0] as string;
    expect(url).toContain("feat%2Fcreate-pr");
    expect(url).toContain("title=feat%3A+Ship+the+feature");
    expect(url).toContain("body=Implements+the+feature+end-to-end.");
  });

  it("navigates to in-app GitHub PR detail on View PR; Open on Web opens browser", async () => {
    await setupPushedWorkspaceWithGitHub();
    vi.mocked(getCachedPrInfo).mockResolvedValue({
      number: 9,
      title: "Existing",
      state: "OPEN",
      url: "https://github.com/acme/treq/pull/9",
      head_ref_name: "feat/create-pr",
      base_ref_name: "main",
      merge_state_status: "CLEAN",
      is_draft: false,
    });
    vi.mocked(ghViewPr).mockResolvedValue({
      number: 9,
      title: "Existing",
      state: "OPEN",
      url: "https://github.com/acme/treq/pull/9",
      body: "PR body",
      author: { login: "alice" },
      labels: [],
      head_ref_name: "feat/create-pr",
      base_ref_name: "main",
      merge_state_status: "CLEAN",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      comments: null,
    });
    render(<Dashboard />);

    const header = await openWorkspace("feat/create-pr");

    const viewPr = await within(header).findByRole("button", {
      name: /view pr.*open/i,
    });
    expect(viewPr.className).toMatch(/border-green-600/);
    expect(
      within(header).queryByRole("button", { name: /^create pr$/i }),
    ).not.toBeInTheDocument();

    await user.click(
      within(header).getByRole("button", { name: /open pr on web/i }),
    );
    expect(openUrl).toHaveBeenCalledWith("https://github.com/acme/treq/pull/9");
    vi.mocked(openUrl).mockClear();

    await user.click(viewPr);
    expect(openUrl).not.toHaveBeenCalled();
    expect(await screen.findByText("Existing")).toBeVisible();
    expect(ghViewPr).toHaveBeenCalledWith("acme/treq", 9);
  });

  it("exposes accessible names for the View PR controls", async () => {
    await setupPushedWorkspaceWithGitHub();
    vi.mocked(getCachedPrInfo).mockResolvedValue({
      number: 9,
      title: "Existing",
      state: "OPEN",
      url: "https://github.com/acme/treq/pull/9",
      head_ref_name: "feat/create-pr",
      base_ref_name: "main",
      merge_state_status: "CLEAN",
      is_draft: false,
    });
    render(<Dashboard />);

    const header = await openWorkspace("feat/create-pr");
    const viewPr = await within(header).findByRole("button", {
      name: /view pr.*open/i,
    });
    const openOnWeb = within(header).getByRole("button", {
      name: /open pr on web/i,
    });

    expect(viewPr).toHaveAttribute("aria-label", "View PR (#9, open)");
    expect(openOnWeb).toHaveAttribute("aria-label", "Open PR on web");
  });

  it("uses draft label when PR is a draft", async () => {
    await setupPushedWorkspaceWithGitHub();
    vi.mocked(getCachedPrInfo).mockResolvedValue({
      number: 12,
      title: "Draft PR",
      state: "OPEN",
      url: "https://github.com/acme/treq/pull/12",
      head_ref_name: "feat/create-pr",
      base_ref_name: "main",
      merge_state_status: "CLEAN",
      is_draft: true,
    });
    render(<Dashboard />);

    const header = await openWorkspace("feat/create-pr");
    expect(
      await within(header).findByRole("button", { name: /view pr.*draft/i }),
    ).toBeVisible();
  });

  it("styles View PR for closed and merged states", async () => {
    await setupPushedWorkspaceWithGitHub();
    vi.mocked(getCachedPrInfo).mockResolvedValue({
      number: 10,
      title: "Closed",
      state: "CLOSED",
      url: "https://github.com/acme/treq/pull/10",
      head_ref_name: "feat/create-pr",
      base_ref_name: "main",
      merge_state_status: null,
    });
    const view = render(<Dashboard />);

    let header = await openWorkspace("feat/create-pr");
    const closed = await within(header).findByRole("button", {
      name: /view pr.*closed/i,
    });
    expect(closed.className).toMatch(/border-red-600/);

    view.unmount();
    vi.mocked(getCachedPrInfo).mockResolvedValue({
      number: 11,
      title: "Merged",
      state: "MERGED",
      url: "https://github.com/acme/treq/pull/11",
      head_ref_name: "feat/create-pr",
      base_ref_name: "main",
      merge_state_status: null,
    });
    render(<Dashboard />);
    header = await openWorkspace("feat/create-pr");
    const merged = await within(header).findByRole("button", {
      name: /view pr.*merged/i,
    });
    expect(merged.className).toMatch(/border-purple-600/);
  });
});
