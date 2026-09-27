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
});
