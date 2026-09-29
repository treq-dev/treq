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

async function setupWorkspaceWithFiles(
  branchName: string,
  files: { name: string; content: string }[],
): Promise<{
  repoPath: string;
  workspace: Workspace;
}> {
  const { repoPath } = createTestRepo(false);
  openRepo(repoPath);

  const workspaceId = await createWorkspace(repoPath, branchName);
  const workspace = (await getWorkspaces(repoPath)).find(
    (item) => item.id === workspaceId,
  );
  if (!workspace) {
    throw new Error(`Workspace not found for id ${workspaceId}`);
  }

  const wsPath = resolveWorkspacePath(repoPath, workspace.workspace_path);
  for (const file of files) {
    writeWorkspaceFile(wsPath, file.name, file.content);
  }

  return { repoPath, workspace };
}

async function openReviewTab(
  user: ReturnType<typeof userEvent.setup>,
  branchName: string,
) {
  render(<Dashboard />);

  await user.click(await findSidebarBranchElement(branchName));

  const reviewTab = await screen.findByRole("tab", { name: /^Changes/ });
  await user.click(reviewTab);
  await screen.findByRole("tab", { name: /^Changes/, selected: true });
}

describe("Review tab - file loading and display", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
  });

  it("should load and display multiple files when review tab is opened", async () => {
    const branchName = "feat/refresh-multi-files";
    await setupWorkspaceWithFiles(branchName, [
      { name: "file1.txt", content: "content one\n" },
      { name: "file2.txt", content: "content two\n" },
      { name: "file3.txt", content: "content three\n" },
    ]);
    await openReviewTab(user, branchName);

    await waitFor(() => {
      expect(screen.getAllByText(/file1\.txt/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/file2\.txt/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/file3\.txt/).length).toBeGreaterThan(0);
    });
  });

  it("should display file content when expanded", async () => {
    const branchName = "feat/refresh-expand";
    await setupWorkspaceWithFiles(branchName, [
      { name: "test.txt", content: "hello world\n" },
    ]);
    await openReviewTab(user, branchName);

    await waitFor(() => {
      expect(screen.getAllByText(/test\.txt/).length).toBeGreaterThan(0);
    });

    const collapseBtn = await screen.findByRole("button", {
      name: "Collapse file diff",
    });
    await user.click(collapseBtn);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Expand file diff" }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Expand file diff" }));

    await waitFor(() => {
      expect(screen.getAllByText(/hello world/).length).toBeGreaterThan(0);
    });
  });
});
