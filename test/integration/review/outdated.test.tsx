import * as React from "react";
import { beforeEach, describe, it } from "vitest";
import {
  createTestRepo,
  findSidebarBranchElement,
  openRepo,
  resolveWorkspacePath,
  runSerially,
  writeWorkspaceFile,
} from "../../utils";
import {
  type Workspace,
  createWorkspace,
  getWorkspaces,
} from "../../../src/lib/api";
import { savePendingReview } from "../../../src/lib/api-extra";
import type { LineComment } from "../../../src/lib/api-types";
import { render, screen, waitFor } from "../../test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import userEvent from "@testing-library/user-event";

runSerially();

async function setupWorkspaceWithChange(branchName: string): Promise<{
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

describe("Outdated comments - persisted comment with non-existent hunk", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
  });

  it("should enter review mode when persisted comment references a non-existent hunk", async () => {
    const branchName = "feat/outdated-comments";
    const { repoPath, workspace } = await setupWorkspaceWithChange(branchName);
    const wsPath = resolveWorkspacePath(repoPath, workspace.workspace_path);

    writeWorkspaceFile(wsPath, "test.txt", "first line\nsecond line\n");

    const outdatedComment: LineComment = {
      id: "outdated-comment-1",
      file_path: "test.txt",
      hunk_id: "nonexistent-hunk-id",
      start_line: 102,
      end_line: 102,
      line_content: ["+old line that was removed"],
      text: "This line needs work",
      created_at: new Date().toISOString(),
    };
    await savePendingReview(repoPath, workspace.id, [outdatedComment]);

    await openReviewTab(user, branchName);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /finish review/i }),
      ).toBeTruthy();
    });

    await screen.findAllByText(/test\.txt/);

    await screen.findAllByRole("button", { name: /^discard$/i });
  });
});
