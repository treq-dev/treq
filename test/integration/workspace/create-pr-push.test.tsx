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
  getPrInfoViaGh,
  getWorkspaceStatus,
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
  setOriginUrl,
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
    ghListPrs: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
    ghListIssues: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
    pushWorkspaceToRemote: vi.fn(
      (repoPath: string, workspaceId: number | null) =>
        original.pushWorkspaceToRemote(repoPath, workspaceId),
    ),
    getWorkspaceStatus: vi.fn(original.getWorkspaceStatus),
  };
});

describe("ShowWorkspace - Create PR pushes the branch first", () => {
  let repoPath: string;
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(async () => {
    const actual = await vi.importActual<typeof import("../../../src/lib/api")>(
      "../../../src/lib/api",
    );
    vi.mocked(getWorkspaceStatus).mockImplementation(actual.getWorkspaceStatus);
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

  it("pushes a rewritten (diverged) branch before creating a PR", async () => {
    const { workspace } = await setupPushedWorkspaceWithGitHub();
    const actual = await vi.importActual<typeof import("../../../src/lib/api")>(
      "../../../src/lib/api",
    );
    vi.mocked(getWorkspaceStatus).mockImplementation(async (...args) => ({
      ...(await actual.getWorkspaceStatus(...args)),
      remote_sync: { type: "Diverged", data: { ahead: 1, behind: 1 } },
    }));
    vi.mocked(pushWorkspaceToRemote).mockClear();
    vi.mocked(pushWorkspaceToRemote).mockResolvedValueOnce("pushed");
    render(<Dashboard />);

    const header = await openWorkspace("feat/create-pr");
    await user.click(await findEnabledCreatePr(header));

    await waitFor(() => {
      expect(ghCreatePr).toHaveBeenCalled();
    });
    expect(pushWorkspaceToRemote).toHaveBeenCalledWith(repoPath, workspace.id);
    expect(
      vi.mocked(pushWorkspaceToRemote).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(ghCreatePr).mock.invocationCallOrder[0]);
  }, 30_000);

  it("reports a push failure after committing as a push error, not a PR error", async () => {
    const workspaceId = await createWorkspace(repoPath, "feat/push-fails");
    const workspace = (await getWorkspaces(repoPath)).find(
      (candidate) => candidate.id === workspaceId,
    )!;
    writeWorkspaceFile(
      resolveWorkspacePath(repoPath, workspace.workspace_path),
      "feature.txt",
      "feature content\n",
    );
    setOriginUrl(repoPath, "https://github.com/acme/treq.git");
    vi.mocked(pushWorkspaceToRemote).mockRejectedValueOnce(
      new Error("remote rejected"),
    );

    render(<Dashboard />);
    await openWorkspace("feat/push-fails");
    await user.click(await screen.findByRole("tab", { name: /changes/i }));
    await screen.findAllByText("feature.txt");
    await user.type(
      await screen.findByPlaceholderText("Message"),
      "Add feature",
    );
    await user.click(
      screen.getByRole("button", { name: /more commit options/i }),
    );
    const commitAndCreatePr = await screen.findByRole("menuitem", {
      name: /commit and create pr/i,
    });
    await waitFor(() => expect(commitAndCreatePr).toBeEnabled());
    await user.click(commitAndCreatePr);

    expect(
      await screen.findByText("Committed, but failed to push", undefined, {
        timeout: 15_000,
      }),
    ).toBeVisible();
    expect(screen.getByText("remote rejected")).toBeVisible();
    expect(screen.queryByText("Failed to create PR")).toBeNull();
    expect(ghCreatePr).not.toHaveBeenCalled();
  }, 30_000);
});
