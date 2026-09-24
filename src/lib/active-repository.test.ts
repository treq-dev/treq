import { describe, expect, it } from "vitest";
import {
  activeRepositoryFromRemote,
  managedSpriteActiveRepository,
  localActiveRepository,
  repositoryCacheKey,
  workspaceIdentityKey,
} from "./active-repository";

describe("repositoryCacheKey", () => {
  it("uses the bare path for local repositories", () => {
    expect(repositoryCacheKey(localActiveRepository("/repo"))).toBe("/repo");
  });

  it("includes endpoint id, generation, and canonical path for ssh", () => {
    const repo = activeRepositoryFromRemote({
      host: "box",
      path: "/srv",
      display_name: "box",
      repo_uri: "ssh://box/srv",
      inspection: {
        root: "/srv",
        repository_type: "jj",
        current_branch: "main",
        default_branch: "main",
        current_change_id: "",
        current_commit_id: "",
        descriptor: {
          id: "id",
          location: { type: "ssh", host: "box", path: "/srv" },
          display_name: "box",
        },
      },
      endpoint_id: "ep-1",
      endpoint_generation: 4,
    });
    expect(repositoryCacheKey(repo)).toBe("ssh:ep-1:gen4:/srv");
  });

  it("keeps managed Sprite repositories separate from local paths", () => {
    const repo = managedSpriteActiveRepository({
      instanceId: "instance-1",
      spriteName: "treq-alice",
      canonicalPath: "/home/sprite/repos/acme/treq",
      registrationId: "registration-1",
      displayName: "acme/treq",
    });

    expect(repositoryCacheKey(repo)).toBe(
      "sprite:instance-1:registration-1:/home/sprite/repos/acme/treq",
    );
  });

  it("qualifies equal workspace ids by source and repository", () => {
    expect(
      workspaceIdentityKey({
        source: "local",
        repositoryId: "repo-local",
        workspaceId: 7,
      }),
    ).not.toBe(
      workspaceIdentityKey({
        source: "sprite",
        repositoryId: "repo-cloud",
        workspaceId: 7,
      }),
    );
  });
});
