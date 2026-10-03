import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSetProxySession } = vi.hoisted(() => ({
  mockSetProxySession: vi.fn(),
}));

vi.mock("./supabase", () => ({
  supabase: {},
  SUPABASE_URL: "https://proj.supabase.co",
}));
vi.mock("./api-tracker", () => ({
  setProxySession: mockSetProxySession,
}));

import {
  ensureProxySessionSync,
  resetProxySessionSyncForTests,
} from "./proxy-session-sync";
import type { AccessTokenSyncDeps } from "./supabase-token-sync";

describe("ensureProxySessionSync", () => {
  beforeEach(() => {
    resetProxySessionSyncForTests();
    mockSetProxySession.mockReset().mockResolvedValue(undefined);
  });

  it("pushes the Supabase URL with the token and clears both on sign-out", async () => {
    let listener: ((token: string | null) => void) | null = null;
    const deps: AccessTokenSyncDeps = {
      getAccessToken: async () => "jwt-1",
      onTokenChange: (l) => {
        listener = l;
      },
      pushToken: (token) =>
        mockSetProxySession(token ? "https://proj.supabase.co" : null, token),
      setInterval: () => {},
    };
    await ensureProxySessionSync(deps);
    listener!(null);
    expect(mockSetProxySession.mock.calls).toEqual([
      ["https://proj.supabase.co", "jwt-1"],
      [null, null],
    ]);
  });

  it("uses the Supabase session by default", async () => {
    const getSession = vi.fn(async () => ({
      data: { session: { access_token: "jwt-2" } },
    }));
    const supabaseModule = await import("./supabase");
    Object.assign(supabaseModule.supabase, {
      auth: { getSession, onAuthStateChange: vi.fn() },
    });
    vi.useFakeTimers();
    try {
      await ensureProxySessionSync();
    } finally {
      vi.useRealTimers();
    }
    expect(mockSetProxySession).toHaveBeenCalledWith(
      "https://proj.supabase.co",
      "jwt-2",
    );
  });
});
