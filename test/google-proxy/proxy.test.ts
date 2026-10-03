import { describe, expect, it, vi } from "vitest";
import {
  isAllowedUrl,
  proxyGoogleRequest,
  RECONNECT_MESSAGE,
  type ProxyDeps,
  type StoredToken,
} from "../../supabase/functions/google-proxy/lib.ts";

const NOW = Date.parse("2026-10-03T12:00:00Z");
const LISTS = "https://tasks.googleapis.com/tasks/v1/users/@me/lists";

function token(overrides: Partial<StoredToken> = {}): StoredToken {
  return {
    access_token: "ya29.current",
    refresh_token: "1//refresh",
    expires_at: new Date(NOW + 60 * 60 * 1000).toISOString(),
    updated_at: "2026-10-03T11:00:00Z",
    ...overrides,
  };
}

function deps(
  stored: StoredToken | null,
  fetchImpl: (url: string, init: RequestInit) => Response,
): ProxyDeps & { saved: unknown[]; calls: [string, RequestInit][] } {
  const saved: unknown[] = [];
  const calls: [string, RequestInit][] = [];
  return {
    saved,
    calls,
    now: () => NOW,
    googleClient: { id: "cid", secret: "secret" },
    store: {
      load: async () => stored,
      save: async (u) => {
        saved.push(u);
      },
    },
    fetch: vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push([String(url), init ?? {}]);
      return fetchImpl(String(url), init ?? {});
    }) as unknown as typeof fetch,
  };
}

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

describe("isAllowedUrl", () => {
  it("allows only the Tasks and Drive APIs", () => {
    expect(isAllowedUrl(LISTS)).toBe(true);
    expect(isAllowedUrl("https://www.googleapis.com/drive/v3/files")).toBe(
      true,
    );
    expect(isAllowedUrl("https://www.googleapis.com/gmail/v1/users/me")).toBe(
      false,
    );
    expect(isAllowedUrl("https://evil.example/tasks/v1/")).toBe(false);
    expect(
      isAllowedUrl("https://tasks.googleapis.com@evil.example/tasks/v1/"),
    ).toBe(false);
    expect(isAllowedUrl("not a url")).toBe(false);
  });
});

describe("proxyGoogleRequest", () => {
  it("forwards with the stored bearer token", async () => {
    const d = deps(token(), () => ok({ items: [] }));
    const result = await proxyGoogleRequest({ method: "GET", url: LISTS }, d);
    expect(result.status).toBe(200);
    expect(d.calls[0][0]).toBe(LISTS);
    expect(
      (d.calls[0][1].headers as Record<string, string>).Authorization,
    ).toBe("Bearer ya29.current");
  });

  it("refuses URLs outside the allowlist without touching the token", async () => {
    const d = deps(token(), () => ok({}));
    const result = await proxyGoogleRequest(
      { url: "https://www.googleapis.com/gmail/v1/users/me/messages" },
      d,
    );
    expect(result.status).toBe(400);
    expect(d.calls).toHaveLength(0);
  });

  it("refreshes an expiring token and keeps the refresh token", async () => {
    const d = deps(
      token({ expires_at: new Date(NOW + 1000).toISOString() }),
      (url) =>
        url.includes("oauth2")
          ? ok({ access_token: "ya29.fresh", expires_in: 3600 })
          : ok({}),
    );
    await proxyGoogleRequest({ url: LISTS }, d);
    expect(d.saved[0]).toMatchObject({
      access_token: "ya29.fresh",
      refresh_token: "1//refresh",
    });
    expect(
      (d.calls[1][1].headers as Record<string, string>).Authorization,
    ).toBe("Bearer ya29.fresh");
  });

  it("asks to reconnect when Google rejects the token", async () => {
    const d = deps(token(), () => new Response("", { status: 401 }));
    const result = await proxyGoogleRequest({ url: LISTS }, d);
    expect(result.status).toBe(401);
    expect(JSON.parse(result.body).error).toBe(RECONNECT_MESSAGE);
  });

  it("reports an unlinked account", async () => {
    const result = await proxyGoogleRequest(
      { url: LISTS },
      deps(null, () => ok({})),
    );
    expect(result.status).toBe(403);
  });
});
