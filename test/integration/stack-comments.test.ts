// @include-parallel
import { describe, expect, it } from "vitest";
import {
  createWorkspace,
  ghSyncStackComments,
  setRepoSetting,
} from "../../src/lib/api";
import { createTestRepo } from "../utils";

describe("gh_sync_stack_comments", () => {
  it("leaves a workspace outside any stack alone", async () => {
    const { repoPath } = createTestRepo(false);
    await createWorkspace(repoPath, "feat/solo");

    await expect(
      ghSyncStackComments(repoPath, "acme/treq", "feat/solo"),
    ).resolves.toEqual({ status: "not_stacked" });
  });

  it("posts nothing for a stack when the repository setting is off", async () => {
    const { repoPath } = createTestRepo(false);
    await createWorkspace(repoPath, "feat/parent");
    await createWorkspace(repoPath, "feat/child", "feat/parent");
    await setRepoSetting(repoPath, "post_stack_comments", "false");

    await expect(
      ghSyncStackComments(repoPath, "acme/treq", "feat/child"),
    ).resolves.toEqual({ status: "disabled" });
  });
});
