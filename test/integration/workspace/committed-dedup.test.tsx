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
  createCommit,
  createWorkspace,
  getWorkspaces,
} from "../../../src/lib/api";
import { render, screen, waitFor } from "../../test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import userEvent from "@testing-library/user-event";

async function setupOverlappingWorkspace(branchName: string) {
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

  writeWorkspaceFile(workspacePath, "shared.txt", "shared v1\n");
  await createCommit(repoPath, workspaceId, "commit shared file");

  writeWorkspaceFile(workspacePath, "shared.txt", "shared v2\n");
  writeWorkspaceFile(workspacePath, "committed-only.txt", "committed only\n");
  await createCommit(repoPath, workspaceId, "commit committed-only file");

  writeWorkspaceFile(workspacePath, "shared.txt", "shared v3\n");
  writeWorkspaceFile(workspacePath, "uncommitted-only.txt", "working only\n");

  return {
    branchName,
    repoPath,
    workspaceId,
  };
}

describe("ShowWorkspace - committed diff dedupe integration", () => {
  let user: ReturnType<typeof userEvent.setup>;

  function getCommittedShowButton() {
    return screen.getByRole("button", { name: /^Show$/ });
  }

  beforeEach(() => {
    user = userEvent.setup();
  });

  it("renders committed and uncommitted hunks from the live backend and toggles committed visibility", async () => {
    const fixture = await setupOverlappingWorkspace("feat/committed-dedupe");

    render(<Dashboard />);
    await user.click(await findSidebarBranchElement(fixture.branchName));

    const reviewTab = await screen.findByRole("tab", { name: /^Changes/ });
    await user.click(reviewTab);
    await screen.findByRole("tab", { name: /^Changes/, selected: true });

    await waitFor(() => {
      expect(screen.getAllByText("shared.txt").length).toBeGreaterThanOrEqual(
        2,
      );
      expect(screen.getByTitle("committed-only.txt")).toBeInTheDocument();
      expect(screen.getByTitle("uncommitted-only.txt")).toBeInTheDocument();
    });

    expect(await screen.findByText("committed only")).toBeInTheDocument();
    expect(
      (await screen.findAllByText("shared v2")).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      (await screen.findAllByText("shared v3")).length,
    ).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText("working only")).toBeInTheDocument();

    await user.click(getCommittedShowButton());
    await waitFor(() => {
      expect(screen.queryByTitle("committed-only.txt")).not.toBeInTheDocument();
      expect(screen.queryByText("committed only")).not.toBeInTheDocument();
      expect(screen.getByTitle("uncommitted-only.txt")).toBeInTheDocument();
      expect(screen.getByTitle("shared.txt")).toBeInTheDocument();
    });

    expect(screen.getAllByText("shared v2").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("shared v3").length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText("working only")).toBeInTheDocument();

    await user.click(getCommittedShowButton());
    await waitFor(() => {
      expect(screen.getAllByText("shared.txt").length).toBeGreaterThanOrEqual(
        2,
      );
      expect(screen.getByTitle("committed-only.txt")).toBeInTheDocument();
    });

    expect(await screen.findByText("committed only")).toBeInTheDocument();
    expect(screen.getAllByText("shared v2").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("shared v3").length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText("working only")).toBeInTheDocument();
  });
});
