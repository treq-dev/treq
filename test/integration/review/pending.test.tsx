import { beforeEach, describe, expect, it } from "vitest";
import {
  createTestRepo,
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
import {
  loadPendingReview,
  savePendingReview,
} from "../../../src/lib/api-extra";
import type { LineComment } from "../../../src/lib/api-types";
import { screen, waitFor } from "../../test-utils";
import userEvent from "@testing-library/user-event";
import {
  addSingleReviewComment,
  clickChangedFile,
  openReviewTab,
} from "./comments-helpers";

runSerially();

const PENDING_FILE = "pending-test.txt";

async function setupWorkspaceWithFile(branchName: string): Promise<{
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
  writeWorkspaceFile(wsPath, PENDING_FILE, "first line\nsecond line\n");

  return { repoPath, workspace };
}

async function openPendingFile() {
  await clickChangedFile(PENDING_FILE);
  await screen.findByText(/first line/);
}

describe("Pending review persistence", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
  });

  it("should load and display persisted comments when review tab is opened", async () => {
    const branchName = "feat/pending-load";
    const { repoPath, workspace } = await setupWorkspaceWithFile(branchName);

    const comment: LineComment = {
      id: "persisted-c1",
      file_path: PENDING_FILE,
      hunk_id: "some-hunk",
      start_line: 1,
      end_line: 1,
      line_content: ["+first line"],
      text: "Persisted comment from previous session",
      created_at: new Date().toISOString(),
    };
    await savePendingReview(repoPath, workspace.id, [comment]);

    await openReviewTab(user, branchName);

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /finish review/i }),
      ).toBeInTheDocument();
    });
  });

  it("should auto-save when user adds a comment", async () => {
    const branchName = "feat/pending-autosave";
    const { repoPath, workspace } = await setupWorkspaceWithFile(branchName);

    await openReviewTab(user, branchName);
    await openPendingFile();

    await addSingleReviewComment(user, "New comment for auto-save");

    await waitFor(async () => {
      const review = await loadPendingReview(repoPath, workspace.id);
      expect(review).not.toBeNull();
      expect(review!.comments.length).toBeGreaterThan(0);
    });
  });

  it("should clear persisted review when user cancels", async () => {
    const branchName = "feat/pending-cancel";
    const { repoPath, workspace } = await setupWorkspaceWithFile(branchName);

    await openReviewTab(user, branchName);
    await openPendingFile();

    await addSingleReviewComment(user, "Comment to be cleared");

    await waitFor(async () => {
      const review = await loadPendingReview(repoPath, workspace.id);
      expect(review).not.toBeNull();
    });

    const actionBarBtns = await screen.findAllByTestId("discard-review");
    await user.click(actionBarBtns[0]);

    await screen.findByText("Discard review?");
    await user.click(
      (await screen.findAllByTestId("confirm-discard-review"))[0],
    );

    await waitFor(async () => {
      const review = await loadPendingReview(repoPath, workspace.id);
      expect(review).toBeNull();
    });
  });

  it("should not clear persisted review when user dismisses cancel dialog", async () => {
    const branchName = "feat/pending-keep";
    const { repoPath, workspace } = await setupWorkspaceWithFile(branchName);

    await openReviewTab(user, branchName);
    await openPendingFile();

    await addSingleReviewComment(user, "Comment to keep");

    await waitFor(async () => {
      const review = await loadPendingReview(repoPath, workspace.id);
      expect(review).not.toBeNull();
    });

    const discardBtns = await screen.findAllByTestId("discard-review");
    await user.click(discardBtns[0]);

    const keepButton = await screen.findByRole("button", {
      name: /keep reviewing/i,
    });
    await user.click(keepButton);

    const review = await loadPendingReview(repoPath, workspace.id);
    expect(review).not.toBeNull();

    await waitFor(() => {
      expect(screen.getAllByText("Comment to keep").length).toBeGreaterThan(0);
    });
  });
});
