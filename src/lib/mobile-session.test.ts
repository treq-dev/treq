import { afterEach, describe, expect, it } from "vitest";
import {
  MOBILE_SESSION_KEY,
  clearMobileSession,
  loadMobileSession,
  parseMobileSession,
  saveMobileSession,
} from "./mobile-session";

afterEach(() => {
  localStorage.clear();
});

describe("mobile session persistence", () => {
  it("round-trips the endpoint, repository and screen", () => {
    saveMobileSession({
      endpoint: { kind: "user_managed", id: "home-box" },
      repoPath: "/srv/app",
      screen: { name: "diff", workspace: "feat-x", path: "src/a.ts" },
    });
    expect(loadMobileSession()).toEqual({
      endpoint: { kind: "user_managed", id: "home-box" },
      repoPath: "/srv/app",
      screen: { name: "diff", workspace: "feat-x", path: "src/a.ts" },
    });
    clearMobileSession();
    expect(loadMobileSession()).toBeNull();
  });

  it("drops fields it does not know, so nothing secret comes back", () => {
    const parsed = parseMobileSession(
      JSON.stringify({
        endpoint: { kind: "managed", certificate: "ssh-cert" },
        repoPath: "/r",
        screen: { name: "agent", workspace: "w", token: "t" },
        certificate: "ssh-cert",
      }),
    );
    expect(parsed).toEqual({
      endpoint: { kind: "managed" },
      repoPath: "/r",
      screen: { name: "agent", workspace: "w" },
    });
  });

  it("rejects records without a usable endpoint", () => {
    expect(parseMobileSession("not json")).toBeNull();
    expect(parseMobileSession(JSON.stringify({ repoPath: "/r" }))).toBeNull();
    expect(
      parseMobileSession(
        JSON.stringify({ endpoint: { kind: "user_managed" } }),
      ),
    ).toBeNull();
  });

  it("drops a screen that is malformed or has no repository", () => {
    expect(
      parseMobileSession(
        JSON.stringify({
          endpoint: { kind: "managed" },
          repoPath: "/r",
          screen: { name: "diff", workspace: "w" },
        }),
      )?.screen,
    ).toBeNull();
    expect(
      parseMobileSession(
        JSON.stringify({
          endpoint: { kind: "managed" },
          screen: { name: "agent", workspace: "w" },
        }),
      )?.screen,
    ).toBeNull();
  });

  it("starts without a session when storage holds garbage", () => {
    localStorage.setItem(MOBILE_SESSION_KEY, "{");
    expect(loadMobileSession()).toBeNull();
  });
});
