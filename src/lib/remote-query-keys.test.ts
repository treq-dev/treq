import { describe, expect, it } from "vitest";
import {
  locationFromHostAndPath,
  remoteRepoIdentity,
  remoteWorkspaceIdentity,
} from "./remote-query-keys";

describe("remoteRepoIdentity", () => {
  it("returns the bare path for a local location", () => {
    expect(remoteRepoIdentity({ type: "local", path: "/repo" })).toBe("/repo");
  });

  it("folds endpoint host and generation into the identity for ssh locations", () => {
    const identity = remoteRepoIdentity(
      { type: "ssh", host: "box", path: "/repo" },
      3,
    );
    expect(identity).toBe("ssh:box:gen3:/repo");
  });

  it("defaults generation to 0 when omitted", () => {
    expect(
      remoteRepoIdentity({ type: "ssh", host: "box", path: "/repo" }),
    ).toBe("ssh:box:gen0:/repo");
  });

  it("changes identity across a generation bump, so caches cannot collide", () => {
    const before = remoteRepoIdentity(
      { type: "ssh", host: "box", path: "/repo" },
      1,
    );
    const after = remoteRepoIdentity(
      { type: "ssh", host: "box", path: "/repo" },
      2,
    );
    expect(before).not.toBe(after);
  });

  it("distinguishes a local repo from a remote repo with the same path", () => {
    const local = remoteRepoIdentity({ type: "local", path: "/repo" });
    const remote = remoteRepoIdentity(
      { type: "ssh", host: "box", path: "/repo" },
      0,
    );
    expect(local).not.toBe(remote);
  });

  it("folds endpoint id into the identity separately from host", () => {
    const byHost = remoteRepoIdentity(
      { type: "ssh", host: "box", path: "/repo" },
      { endpointGeneration: 1 },
    );
    const byId = remoteRepoIdentity(
      { type: "ssh", host: "box", path: "/repo" },
      { endpointGeneration: 1, endpointId: "ep-9" },
    );
    expect(byId).toBe("ssh:ep-9:gen1:/repo");
    expect(byHost).not.toBe(byId);
  });
});

describe("remoteWorkspaceIdentity", () => {
  it("extends a repo identity with a workspace id", () => {
    expect(remoteWorkspaceIdentity("ssh:box:gen0:/repo", 5)).toBe(
      "ssh:box:gen0:/repo::workspace:5",
    );
  });

  it("distinguishes null workspace from a numeric one", () => {
    const forNull = remoteWorkspaceIdentity("id", null);
    const forZero = remoteWorkspaceIdentity("id", 0);
    expect(forNull).not.toBe(forZero);
  });
});

describe("locationFromHostAndPath", () => {
  it("builds an ssh location when both host and path are present", () => {
    expect(locationFromHostAndPath("box", "/repo")).toEqual({
      type: "ssh",
      host: "box",
      path: "/repo",
    });
  });

  it("returns undefined when either half is missing", () => {
    expect(locationFromHostAndPath(undefined, "/repo")).toBeUndefined();
    expect(locationFromHostAndPath("box", undefined)).toBeUndefined();
  });
});
