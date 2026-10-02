import { afterEach, describe, expect, it } from "vitest";
import { syncRepoUrlParam } from "./repo-url";

describe("syncRepoUrlParam", () => {
  afterEach(() => window.history.replaceState(null, "", "/index.html"));

  it("replaces a stale repo param so reload opens the current repo", () => {
    window.history.replaceState(null, "", "/index.html?repo=%2Fold");
    syncRepoUrlParam("/new repo");
    expect(new URLSearchParams(window.location.search).get("repo")).toBe(
      "/new repo",
    );
  });

  it("removes the param when no repo is open, keeping others", () => {
    window.history.replaceState(null, "", "/index.html?repo=%2Fold&x=1");
    syncRepoUrlParam("");
    expect(window.location.search).toBe("?x=1");
  });
});
