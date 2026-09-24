import { describe, expect, it } from "vitest";
import {
  canCombineWorkspaceIdentities,
  workspaceIdentityKey,
  type WorkspaceIdentity,
} from "./active-repository";

const identity = (
  source: WorkspaceIdentity["source"],
  repositoryId: string,
  workspaceId: number,
): WorkspaceIdentity => ({ source, repositoryId, workspaceId });

describe("workspace source boundaries", () => {
  it("uses distinct keys for identical numeric ids", () => {
    expect(workspaceIdentityKey(identity("local", "repo", 4))).not.toBe(
      workspaceIdentityKey(identity("sprite", "repo", 4)),
    );
  });

  it("allows bulk operations only within one source repository", () => {
    expect(
      canCombineWorkspaceIdentities([
        identity("sprite", "cloud-repo", 1),
        identity("sprite", "cloud-repo", 2),
      ]),
    ).toBe(true);
    expect(
      canCombineWorkspaceIdentities([
        identity("local", "local-repo", 1),
        identity("sprite", "cloud-repo", 2),
      ]),
    ).toBe(false);
  });
});
