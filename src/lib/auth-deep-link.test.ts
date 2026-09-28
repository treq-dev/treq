import { describe, expect, it, vi } from "vitest";

const deepLink = vi.hoisted(() => ({
  handler: null as ((urls: string[]) => void) | null,
  current: null as string[] | null,
}));

vi.mock("@tauri-apps/plugin-deep-link", () => ({
  onOpenUrl: vi.fn(async (handler: (urls: string[]) => void) => {
    deepLink.handler = handler;
    return () => {};
  }),
  getCurrent: vi.fn(async () => deepLink.current),
}));

import { authCallbackToken, listenForAuthCallbacks } from "./auth-deep-link";

describe("authCallbackToken", () => {
  it("reads the token from a treq auth callback", () => {
    expect(authCallbackToken(["treq://auth/callback?token=abc"])).toBe("abc");
  });

  it("ignores other links", () => {
    expect(
      authCallbackToken([
        "treq://agent/start?repo=/r",
        "https://example.com/auth/callback?token=abc",
        "not a url",
      ]),
    ).toBeNull();
  });
});

describe("listenForAuthCallbacks", () => {
  it("handles the launch link and later links, each token once", async () => {
    deepLink.current = ["treq://auth/callback?token=launch"];
    const onToken = vi.fn();

    await listenForAuthCallbacks(onToken);
    deepLink.handler?.(["treq://auth/callback?token=later"]);
    deepLink.handler?.(["treq://auth/callback?token=later"]);
    // A second listener (e.g. the shell remounting) sees the same launch
    // link again and must not reuse the spent token.
    await listenForAuthCallbacks(onToken);

    expect(onToken.mock.calls).toEqual([["launch"], ["later"]]);
  });
});
