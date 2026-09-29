// @include-serial
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
} from "../../../src/lib/api";
import { render, screen, waitFor, within } from "../../test-utils";
import { Dashboard } from "../../../src/components/Dashboard";

async function setupWorkspaceWithCommittedAndUncommitted(branchName: string) {
  const { repoPath } = createTestRepo(false);
  openRepo(repoPath);

  const workspaceId = await createWorkspace(repoPath, branchName);
  const workspace = (await getWorkspaces(repoPath)).find(
    (item) => item.id === workspaceId,
  );
  if (!workspace) throw new Error(`Workspace not found for id ${workspaceId}`);

  const workspacePath = resolveWorkspacePath(
    repoPath,
    workspace.workspace_path,
  );

  writeWorkspaceFile(workspacePath, "committed-only.txt", "committed\n");
  await createCommit(repoPath, workspaceId, "commit committed-only file");

  writeWorkspaceFile(workspacePath, "uncommitted-only.txt", "working only\n");

  return { branchName, repoPath, workspaceId };
}

function getReviewBadgeCount(): number | null {
  const tab = screen.getByRole("tab", { name: /^Changes/ });
  const badge = within(tab).queryByTestId("review-change-count");
  if (!badge?.textContent) return null;
  return Number(badge.textContent);
}

describe("Review tab change count", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
  });

  it("shows total unique committed + uncommitted files before and after selecting Review", async () => {
    const fixture =
      await setupWorkspaceWithCommittedAndUncommitted("feat/review-count");

    render(<Dashboard />);
    await user.click(await findSidebarBranchElement(fixture.branchName));
    await screen.findByTestId("show-workspace-header");

    await waitFor(() => {
      expect(getReviewBadgeCount()).toBe(2);
    });

    const before = getReviewBadgeCount();
    await user.click(await screen.findByRole("tab", { name: /^Changes/ }));
    await screen.findByRole("tab", { name: /^Changes/, selected: true });
    await screen.findByTitle("uncommitted-only.txt");
    await screen.findByTitle("committed-only.txt");

    await waitFor(() => {
      expect(getReviewBadgeCount()).toBe(2);
    });
    expect(getReviewBadgeCount()).toBe(before);
  });

  it("updates the Changes tab badge when switching to a workspace with no changes", async () => {
    const fixture =
      await setupWorkspaceWithCommittedAndUncommitted("feat/review-count");
    await createWorkspace(fixture.repoPath, "feat/clean");

    render(<Dashboard />);
    await user.click(await findSidebarBranchElement(fixture.branchName));
    await screen.findByTestId("show-workspace-header");
    await waitFor(() => {
      expect(getReviewBadgeCount()).toBe(2);
    });

    await user.click(await findSidebarBranchElement("feat/clean"));
    const header = await screen.findByTestId("show-workspace-header");
    await waitFor(() => {
      expect(header).toHaveTextContent("feat/clean");
    });
    await waitFor(() => {
      expect(getReviewBadgeCount()).toBeNull();
    });
  });

  it("updates the Changes tab badge when switching back to the home repo", async () => {
    const fixture =
      await setupWorkspaceWithCommittedAndUncommitted("feat/review-count");

    render(<Dashboard />);
    await user.click(await findSidebarBranchElement(fixture.branchName));
    await screen.findByTestId("show-workspace-header");
    await waitFor(() => {
      expect(getReviewBadgeCount()).toBe(2);
    });

    await user.click(await screen.findByTestId("home-repo-row"));
    await waitFor(() => {
      expect(getReviewBadgeCount()).not.toBe(2);
    });
  });
});
