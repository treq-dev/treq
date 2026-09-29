import * as React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import {
  createTestRepo,
  findSidebarBranchElement,
  openRepo,
  resolveWorkspacePath,
  writeWorkspaceFile,
} from "../../utils";
import {
  createCommit,
  createWorkspace,
  getWorkspaces,
  listCommits,
} from "../../../src/lib/api";
import { sumWorkspaceLocFromLog } from "../../../src/lib/workspace-stack";
import { render, screen, waitFor } from "../../test-utils";
import { Dashboard } from "../../../src/components/Dashboard";

describe("ShowWorkspace tab-row LOC marker", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
  });

  it("shows committed + working-copy LOC pulled right of the tab buttons", async () => {
    const { repoPath } = createTestRepo(false);
    openRepo(repoPath);

    const branchName = "feat/loc-marker";
    const workspaceId = await createWorkspace(repoPath, branchName);
    const workspace = (await getWorkspaces(repoPath)).find(
      (item) => item.id === workspaceId,
    );
    if (!workspace)
      throw new Error(`Workspace not found for id ${workspaceId}`);

    const workspacePath = resolveWorkspacePath(
      repoPath,
      workspace.workspace_path,
    );

    writeWorkspaceFile(
      workspacePath,
      "committed.txt",
      "one\ntwo\nthree\nfour\nfive\n",
    );
    await createCommit(repoPath, workspaceId, "add committed file");

    writeWorkspaceFile(workspacePath, "working.txt", "a\nb\nc\n");

    const expected = sumWorkspaceLocFromLog(
      await listCommits(repoPath, workspaceId),
    );
    expect(expected.insertions).toBeGreaterThan(0);

    render(<Dashboard />);
    await user.click(await findSidebarBranchElement(branchName));
    await screen.findByTestId("show-workspace-header");

    const marker = await screen.findByTestId("loc-diff-marker");
    await waitFor(() => {
      expect(marker.textContent).toContain(`+${expected.insertions}`);
      expect(marker.textContent).toContain(`-${expected.deletions}`);
    });

    const codeTab = screen.getByRole("tab", { name: /^Code/ });
    const row = screen.getByTestId("workspace-tab-row");
    expect(row.contains(codeTab)).toBe(true);
    expect(row.contains(marker)).toBe(true);
  });

  it("hides the marker when the workspace has no LOC changes", async () => {
    const { repoPath } = createTestRepo(false);
    openRepo(repoPath);

    const branchName = "feat/loc-empty";
    await createWorkspace(repoPath, branchName);

    render(<Dashboard />);
    await user.click(await findSidebarBranchElement(branchName));
    await screen.findByTestId("show-workspace-header");
    await screen.findByRole("tab", { name: /^Code/ });

    await waitFor(() => {
      expect(screen.queryByTestId("loc-diff-marker")).toBeNull();
    });
  });
});
