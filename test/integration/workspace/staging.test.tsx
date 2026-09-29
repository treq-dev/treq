// @include-serial
import * as React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createTestRepo,
  findSidebarBranchElement,
  openRepo,
  resolveWorkspacePath,
  writeWorkspaceFile,
} from "../../utils";
import {
  type Workspace,
  createWorkspace,
  getWorkspaces,
} from "../../../src/lib/api";
import { render, screen, waitFor } from "../../test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import userEvent from "@testing-library/user-event";

async function setupWorkspaceWithChange(branchName: string): Promise<{
  repoPath: string;
  workspace: Workspace;
}> {
  const { repoPath } = createTestRepo(false);
  openRepo(repoPath);

  const workspaceId = await createWorkspace(repoPath, branchName);
  const workspace = (await getWorkspaces(repoPath)).find(
    (w) => w.id === workspaceId,
  );
  if (!workspace) throw new Error(`Workspace not found for id ${workspaceId}`);

  writeWorkspaceFile(
    resolveWorkspacePath(repoPath, workspace.workspace_path),
    "stage-test.txt",
    "line one\nline two\nline three\n",
  );

  return { repoPath, workspace };
}

describe("ShowWorkspace - File staging integration", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
  });

  it("stages a file and shows it in the Selected section", async () => {
    const branchName = "feat/staging-test";
    await setupWorkspaceWithChange(branchName);

    render(<Dashboard />);
    await user.click(await findSidebarBranchElement(branchName));

    const reviewTab = await screen.findByRole("tab", { name: /^Changes/ });
    await user.click(reviewTab);
    await screen.findByRole("tab", { name: /^Changes/, selected: true });

    await waitFor(() =>
      expect(screen.getAllByText("stage-test.txt").length).toBeGreaterThan(0),
    );

    const fileRows = screen.getAllByText("stage-test.txt");
    await user.click(fileRows[0]);

    const stageButton = await screen.findByTitle("Stage file(s) for commit");
    await user.click(stageButton);

    await screen.findByText("Selected");
  });

  it("collapses and expands file diffs with toggle button", async () => {
    const branchName = "feat/collapse-test";
    await setupWorkspaceWithChange(branchName);

    render(<Dashboard />);
    await user.click(await findSidebarBranchElement(branchName));

    const reviewTab = await screen.findByRole("tab", { name: /^Changes/ });
    await user.click(reviewTab);
    await screen.findByRole("tab", { name: /^Changes/, selected: true });

    await waitFor(() =>
      expect(screen.getAllByText("stage-test.txt").length).toBeGreaterThan(0),
    );

    const collapseBtn = await screen.findByRole("button", {
      name: "Collapse file diff",
    });
    await user.click(collapseBtn);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Expand file diff" }),
      ).toBeInTheDocument();
    });
  });
});
