// @include-serial
import * as React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
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
import { render, screen, waitFor } from "../../test-utils";
import { Dashboard } from "../../../src/components/Dashboard";

describe("Review - deleted file collapsible", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
  });

  it("marks deleted files and does not render their former contents", async () => {
    const { repoPath } = createTestRepo(false);
    openRepo(repoPath);

    const workspaceId = await createWorkspace(repoPath, "feat/deleted-file");
    const workspace = (await getWorkspaces(repoPath)).find(
      (w) => w.id === workspaceId,
    );
    if (!workspace) throw new Error("Workspace not found");
    const workspacePath = resolveWorkspacePath(
      repoPath,
      workspace.workspace_path,
    );

    writeWorkspaceFile(
      workspacePath,
      "doomed.txt",
      "secret line one\nsecret line two\n",
    );
    await createCommit(repoPath, workspaceId, "add doomed file");
    fs.unlinkSync(path.join(workspacePath, "doomed.txt"));

    render(<Dashboard />);
    await user.click(await findSidebarBranchElement("feat/deleted-file"));
    await user.click(await screen.findByRole("tab", { name: /^Changes/ }));
    await screen.findByRole("tab", { name: /^Changes/, selected: true });

    await waitFor(() => {
      expect(screen.getAllByText("doomed.txt").length).toBeGreaterThan(0);
    });
    expect(await screen.findByText("Deleted")).toBeInTheDocument();
    expect(
      await screen.findByTestId("deleted-file-placeholder"),
    ).toHaveTextContent("File deleted");
    expect(screen.queryByText("secret line one")).not.toBeInTheDocument();
    expect(screen.queryByText("secret line two")).not.toBeInTheDocument();
  });
});
