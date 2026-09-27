import { afterEach, describe, expect, it, vi } from "vitest";
import {
  localActiveRepository,
  setActiveRepositorySingleton,
  type ActiveRepository,
} from "./active-repository";
import type { SshEndpoint } from "./api-types-remote";

const { dispatchMutationOverSsh } = vi.hoisted(() => ({
  dispatchMutationOverSsh: vi.fn(),
}));

vi.mock("./remote-dispatch", () => ({
  dispatch: vi.fn(),
  dispatchMutationOverSsh,
}));

vi.mock("./remote-mutation-ui", () => ({
  applyMutationDispatchResult: (result: { status: string; value?: unknown }) =>
    result.status === "applied" ? result.value : undefined,
}));

import { transportCreateCommit } from "./repository-adapter";

const endpoint = {
  id: "ep-1",
  instance_id: "instance-1",
  hostname: "vm.example.test",
  port: 22,
  username: "treq",
} as unknown as SshEndpoint;

function sshRepository(): ActiveRepository {
  return {
    id: "repo-1",
    location: { type: "ssh", host: "vm.example.test", path: "/srv/repo" },
    endpoint,
    endpointId: endpoint.id,
    endpointGeneration: 1,
    canonicalPath: "/srv/repo",
    displayName: "repo",
    transport: { type: "ssh", endpoint },
  };
}

afterEach(() => {
  setActiveRepositorySingleton(null);
  vi.clearAllMocks();
});

describe("transportCreateCommit", () => {
  it("sends mutations for SSH repositories over the SSH transport", async () => {
    setActiveRepositorySingleton(sshRepository());
    dispatchMutationOverSsh.mockResolvedValue({
      status: "applied",
      value: "commit-1",
    });
    const local = vi.fn();

    await expect(
      transportCreateCommit("/srv/repo", null, "msg", local),
    ).resolves.toBe("commit-1");

    expect(local).not.toHaveBeenCalled();
    expect(dispatchMutationOverSsh).toHaveBeenCalledWith(endpoint, {
      kind: "CreateCommit",
      repo: "/srv/repo",
      workspace: null,
      message: "msg",
    });
  });

  it("runs local repositories through the local callback only", async () => {
    setActiveRepositorySingleton(localActiveRepository("/repo"));
    const local = vi.fn().mockResolvedValue("local-commit");

    await expect(
      transportCreateCommit("/repo", null, "msg", local),
    ).resolves.toBe("local-commit");
    expect(dispatchMutationOverSsh).not.toHaveBeenCalled();
  });
});
