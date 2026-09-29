import * as React from "react";
import { beforeEach, describe, expect, it } from "vitest";
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
  listCommits,
} from "../../../src/lib/api";
import { render, screen, waitFor } from "../../test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import userEvent from "@testing-library/user-event";

runSerially();

const REVIEW_FILE = "commit-reload.txt";

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

  writeWorkspaceFile(
    resolveWorkspacePath(repoPath, workspace.workspace_path),
    REVIEW_FILE,
    "first review line\nsecond review line\n",
  );

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

async function addSingleReviewComment(
  user: ReturnType<typeof userEvent.setup>,
  comment: string,
) {
  await user.click(
    (await screen.findAllByRole("button", { name: /add comment/i }))[0],
  );
  await user.type(
    await screen.findByPlaceholderText(/add a comment/i),
    comment,
  );

  const submit = screen
    .getAllByRole("button", { name: /add comment/i })
    .find((button) => button.textContent === "Add Comment");
  expect(submit).toBeTruthy();
  await user.click(submit!);
  await screen.findByText(comment);
}

describe("Review tab - auto-reload after commit", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
  });

  it("reloads the review diff after commit instead of showing the stale-files banner", async () => {
    const branchName = "feat/commit-auto-reload";
    const commitMessage = "Commit while reviewing";
    const { repoPath, workspace } = await setupWorkspaceWithChange(branchName);
    await openReviewTab(user, branchName);

    await waitFor(() => {
      expect(screen.getAllByText(REVIEW_FILE).length).toBeGreaterThan(0);
    });
    await addSingleReviewComment(user, "Please tighten this change");

    await user.type(screen.getByPlaceholderText("Message"), commitMessage);
    await user.click(screen.getByRole("button", { name: /^commit$/i }));

    await waitFor(async () => {
      const log = await listCommits(
        repoPath,
        workspace.id,
        false,
        undefined,
        30,
      );
      expect(
        log.commits.some((commit) => commit.description === commitMessage),
      ).toBe(true);
    });

    await waitFor(() => {
      expect(
        screen.queryByText(/changed since you started reviewing/i),
      ).toBeNull();
      expect(screen.queryByRole("button", { name: /^reload$/i })).toBeNull();
      expect(screen.getByTestId("committed-file-label")).toBeInTheDocument();
      expect(
        screen.getByTestId("file-row-commit-reload.txt"),
      ).toBeInTheDocument();
    });
  });
});
