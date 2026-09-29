import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: {} }));
vi.mock("./api-extra", () => ({ remoteSetRelayAccessToken: vi.fn() }));

import {
  ensureRelayAccessTokenSync,
  resetRelayAccessTokenSyncForTests,
  type RelayAuthDeps,
} from "./remote-relay-auth";

function makeDeps(initial: string | null) {
  let listener: ((token: string | null) => void) | null = null;
  let tick: (() => void) | null = null;
  let current = initial;
  const deps: RelayAuthDeps = {
    getAccessToken: vi.fn(async () => current),
    onTokenChange: (l) => {
      listener = l;
    },
    pushToken: vi.fn().mockResolvedValue(undefined),
    setInterval: (callback) => {
      tick = callback;
    },
  };
  return {
    deps,
    emit: (token: string | null) => listener?.(token),
    tick: async (token: string | null) => {
      current = token;
      tick?.();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe("ensureRelayAccessTokenSync", () => {
  beforeEach(() => resetRelayAccessTokenSyncForTests());

  it("pushes the current token before resolving", async () => {
    const { deps } = makeDeps("jwt-1");
    await ensureRelayAccessTokenSync(deps);
    expect(deps.pushToken).toHaveBeenCalledWith("jwt-1");
  });

  it("starts only once per run", async () => {
    const first = makeDeps("jwt-1");
    const second = makeDeps("jwt-2");
    await ensureRelayAccessTokenSync(first.deps);
    await ensureRelayAccessTokenSync(second.deps);
    expect(second.deps.pushToken).not.toHaveBeenCalled();
  });

  it("pushes refreshed tokens and clears on sign-out, skipping repeats", async () => {
    const { deps, emit, tick } = makeDeps("jwt-1");
    await ensureRelayAccessTokenSync(deps);
    await tick("jwt-1");
    emit("jwt-2");
    await tick("jwt-2");
    emit(null);
    expect(vi.mocked(deps.pushToken).mock.calls).toEqual([
      ["jwt-1"],
      ["jwt-2"],
      [null],
    ]);
  });
});
