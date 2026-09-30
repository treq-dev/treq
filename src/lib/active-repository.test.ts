import { describe, expect, it } from "vitest";
import {
  activeRepositoryFromRemote,
  localActiveRepository,
  repositoryCacheKey,
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

  it("keeps an ssh location when the remote inspection describes it as local", () => {
    const repo = activeRepositoryFromRemote({
      host: "box",
      path: "/srv",
      display_name: "srv",
      repo_uri: "ssh://box/srv",
      inspection: {
        root: "/srv",
        repository_type: "jj",
        current_branch: "main",
        default_branch: "main",
        current_change_id: "",
        current_commit_id: "",
        descriptor: {
          id: "local:/srv",
          location: { type: "local", path: "/srv" },
          display_name: "srv",
        },
      },
      endpoint_id: "ep-1",
      endpoint_generation: 0,
    });
    expect(repo.location).toEqual({ type: "ssh", host: "box", path: "/srv" });
    expect(repo.id).toBe("box:/srv");
    expect(repo.transport).toEqual({ type: "unresolved" });
  });
});
