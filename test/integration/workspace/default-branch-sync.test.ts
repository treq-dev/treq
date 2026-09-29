// @include-parallel
import { describe, expect, it } from "vitest";
import {
  createTestRepo,
  openRepo,
  resolveCommitId,
  resolveWorkspacePath,
  writeWorkspaceFile,
} from "../../utils";
import {
  createCommit,
  createWorkspace,
  getWorkspaces,
  switchRepoBranch,
} from "../../../src/lib/api";

describe("default-branch workspace sync after home commit", () => {
  it("syncs same-branch workspace tip when committing in home repo", async () => {
    const { repoPath } = createTestRepo(false);
    openRepo(repoPath);

    const workspaceId = await createWorkspace(repoPath, "main");
    const workspace = (await getWorkspaces(repoPath)).find(
      (w) => w.id === workspaceId,
    );
    expect(workspace).toBeTruthy();
    const workspacePath = resolveWorkspacePath(
      repoPath,
      workspace!.workspace_path,
    );
    await switchRepoBranch(repoPath, "main");

    const beforeMain = resolveCommitId(repoPath, "main");
    const beforeWorkspaceMain = resolveCommitId(workspacePath, "main");
    expect(beforeWorkspaceMain).toEqual(beforeMain);

    writeWorkspaceFile(repoPath, "home-sync.txt", "home sync commit\n", true);
    await createCommit(repoPath, null, "home commit updates main");

    const afterMain = resolveCommitId(repoPath, "main");
    expect(afterMain).not.toEqual(beforeMain);

    const afterWorkspaceMain = resolveCommitId(workspacePath, "main");
    expect(afterWorkspaceMain).toEqual(afterMain);
  });

  it("does not overwrite workspace working copy when it has local uncommitted changes", async () => {
    const { repoPath } = createTestRepo(false);
    openRepo(repoPath);

    const workspaceId = await createWorkspace(repoPath, "main");
    const workspace = (await getWorkspaces(repoPath)).find(
      (w) => w.id === workspaceId,
    );
    expect(workspace).toBeTruthy();
    const workspacePath = resolveWorkspacePath(
      repoPath,
      workspace!.workspace_path,
    );
    await switchRepoBranch(repoPath, "main");

    writeWorkspaceFile(
      workspacePath,
      "dirty.txt",
      "dirty workspace content\n",
      true,
    );
    const workspaceAtBefore = resolveCommitId(workspacePath, "@");

    writeWorkspaceFile(
      repoPath,
      "home-dirty-safe-sync.txt",
      "home commit\n",
      true,
    );
    await createCommit(repoPath, null, "home commit with dirty workspace");

    const mainAfter = resolveCommitId(repoPath, "main");
    const workspaceMainAfter = resolveCommitId(workspacePath, "main");
    expect(workspaceMainAfter).toEqual(mainAfter);

    const workspaceAtAfter = resolveCommitId(workspacePath, "@");
    expect(workspaceAtAfter).toEqual(workspaceAtBefore);
  });
});
