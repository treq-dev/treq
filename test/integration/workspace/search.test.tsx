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
import { screen, waitFor } from "../../test-utils";
import userEvent from "@testing-library/user-event";
import { openReviewTab, waitForChangedFile } from "../review/comments-helpers";

runSerially();

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
    "search-test.txt",
    "hello world line one\nhello world line two\nsome other content\n",
  );

  return { repoPath, workspace };
}

describe("ShowWorkspace - Search integration", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
  });

  it("opens search overlay with Ctrl+F and shows matches", async () => {
    const branchName = "feat/search-test";
    await setupWorkspaceWithChange(branchName);

    await openReviewTab(user, branchName);
    await waitForChangedFile("search-test.txt");

    await user.keyboard("{Control>}f{/Control}");

    const searchInput = await screen.findByPlaceholderText("Find");
    expect(searchInput).toBeInTheDocument();

    await user.type(searchInput, "hello");

    await waitFor(() => {
      expect(screen.queryByText(/of \d+/)).toBeTruthy();
    });
  });

  it("closes search overlay with Escape", async () => {
    const branchName = "feat/search-close-test";
    await setupWorkspaceWithChange(branchName);

    await openReviewTab(user, branchName);
    await waitForChangedFile("search-test.txt");

    await user.keyboard("{Control>}f{/Control}");
    const searchInput = await screen.findByPlaceholderText("Find");
    expect(searchInput).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByPlaceholderText("Find")).toBeNull();
    });
  });
});
