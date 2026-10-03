import { describe, expect, it, vi } from "vitest";
import {
  isAllowedRequest,
  PRO_REQUIRED_MESSAGE,
  proxyGoogleRequest,
  RECONNECT_MESSAGE,
  TOO_LARGE_MESSAGE,
  TREQ_SESSION_UNAUTHORIZED,
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
  pro = true,
): ProxyDeps & { saved: unknown[]; calls: [string, RequestInit][] } {
  const saved: unknown[] = [];
  const calls: [string, RequestInit][] = [];
  return {
    saved,
    calls,
    now: () => NOW,
    isPro: async () => pro,
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

const DRIVE = "https://www.googleapis.com/drive/v3";

describe("isAllowedRequest", () => {
  it("allows the calls the app makes", () => {
    for (const [method, url] of [
      ["GET", LISTS],
      ["POST", LISTS],
      [
        "GET",
        "https://tasks.googleapis.com/tasks/v1/lists/L1/tasks?showCompleted=true",
      ],
      ["PATCH", "https://tasks.googleapis.com/tasks/v1/lists/L1/tasks/t1"],
      ["DELETE", "https://tasks.googleapis.com/tasks/v1/lists/L1/tasks/t1"],
      [
        "POST",
        "https://tasks.googleapis.com/tasks/v1/lists/L1/tasks/t1/move?destinationTasklist=L2",
      ],
      ["GET", `${DRIVE}/files?q=x`],
      ["GET", `${DRIVE}/files/doc1?alt=media`],
      ["GET", `${DRIVE}/files/doc1/export?mimeType=text%2Fmarkdown`],
      ["POST", `${DRIVE}/files/doc1/comments?fields=id`],
    ]) {
      expect(isAllowedRequest(method, url), `${method} ${url}`).toBe(true);
    }
  });

  it("refuses destructive Drive calls, other APIs and path tricks", () => {
    for (const [method, url] of [
      ["DELETE", `${DRIVE}/files/doc1`],
      ["PATCH", `${DRIVE}/files/doc1`],
      ["POST", `${DRIVE}/files/doc1/permissions`],
      ["POST", `${DRIVE}/files`],
      ["GET", `${DRIVE}/files/doc1/comments/../permissions`],
      ["GET", `${DRIVE}/files/%2e%2e/about`],
      ["GET", `${DRIVE}/about`],
      ["DELETE", LISTS],
      ["GET", "https://www.googleapis.com/gmail/v1/users/me"],
      [
        "GET",
        "https://tasks.googleapis.com@evil.example/tasks/v1/users/@me/lists",
      ],
      ["GET", "https://evil.example/tasks/v1/users/@me/lists"],
      ["GET", "not a url"],
    ]) {
      expect(isAllowedRequest(method, url), `${method} ${url}`).toBe(false);
    }
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
      { url: `${DRIVE}/files/doc1/permissions`, method: "POST" },
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

  it("reports link status without forwarding", async () => {
    const linked = deps(token(), () => ok({}));
    const result = await proxyGoogleRequest({ op: "status" }, linked);
    expect(JSON.parse(result.body)).toEqual({ linked: true });
    expect(linked.calls).toHaveLength(0);
    const unlinked = await proxyGoogleRequest(
      { op: "status" },
      deps(null, () => ok({})),
    );
    expect(JSON.parse(unlinked.body)).toEqual({ linked: false });
  });

  it("refuses users without an active Pro plan", async () => {
    const d = deps(token(), () => ok({}), false);
    for (const request of [{ url: LISTS }, { op: "status" as const }]) {
      const result = await proxyGoogleRequest(request, d);
      expect(result.status).toBe(403);
      expect(JSON.parse(result.body).error).toBe(PRO_REQUIRED_MESSAGE);
    }
    expect(d.calls).toHaveLength(0);
  });

  it("reports an unlinked account", async () => {
    const result = await proxyGoogleRequest(
      { url: LISTS },
      deps(null, () => ok({})),
    );
    expect(result.status).toBe(403);
  });
});

describe("hardening", () => {
  it("exports the treq-session 401 body", () => {
    expect(TREQ_SESSION_UNAUTHORIZED).toEqual({
      error: "Unauthorized",
      code: "treq_session",
    });
  });

  it("rejects malformed input with 400", async () => {
    for (const request of [
      null,
      "x",
      [],
      { method: 1, url: LISTS },
      { method: "GET", url: 5 },
      { method: "GET" },
    ]) {
      const d = deps(token(), () => ok({}));
      const result = await proxyGoogleRequest(request as never, d);
      expect(result.status, JSON.stringify(request)).toBe(400);
      expect(d.calls).toHaveLength(0);
    }
  });

  it("refreshes when expires_at is unparseable", async () => {
    const d = deps(token({ expires_at: "garbage" }), (url) =>
      url.includes("oauth2")
        ? ok({ access_token: "ya29.fresh", expires_in: 3600 })
        : ok({}),
    );
    await proxyGoogleRequest({ url: LISTS }, d);
    expect(d.calls[0][0]).toContain("oauth2");
  });

  it("allows only listed query params per endpoint", () => {
    const T = "https://tasks.googleapis.com/tasks/v1";
    const allowed: [string, string][] = [
      ["GET", `${LISTS}?maxResults=10&pageToken=a`],
      [
        "GET",
        `${T}/lists/L/tasks?maxResults=1&showCompleted=true&showHidden=true&pageToken=p`,
      ],
      ["POST", `${T}/lists/L/tasks?parent=a&previous=b`],
      [
        "POST",
        `${T}/lists/L/tasks/t/move?destinationTasklist=a&parent=b&previous=c`,
      ],
      [
        "GET",
        `${DRIVE}/files?pageSize=1&pageToken=a&q=x&orderBy=name&fields=f&supportsAllDrives=true&includeItemsFromAllDrives=true`,
      ],
      ["GET", `${DRIVE}/files/d?fields=f&supportsAllDrives=true&alt=media`],
    ];
    for (const [m, u] of allowed) expect(isAllowedRequest(m, u), u).toBe(true);
    const refused: [string, string][] = [
      ["POST", `${LISTS}?maxResults=1`],
      ["GET", `${LISTS}?key=x`],
      ["PATCH", `${T}/lists/L/tasks/t?x=1`],
      ["DELETE", `${T}/lists/L/tasks/t?x=1`],
      ["GET", `${DRIVE}/files/d?alt=json`],
      ["GET", `${DRIVE}/files/d?alt=media&alt=media2`],
      ["GET", `${DRIVE}/files/d/export?mimeType=a&fields=x`],
      ["POST", `${DRIVE}/files/d/comments?uploadType=x`],
      ["GET", `${DRIVE}/files?access_token=x`],
    ];
    for (const [m, u] of refused) expect(isAllowedRequest(m, u), u).toBe(false);
  });

  it("returns 413 for oversized responses", async () => {
    const big = deps(
      token(),
      () =>
        new Response("x", {
          headers: { "content-length": String(21 * 1024 * 1024) },
        }),
    );
    const r1 = await proxyGoogleRequest({ url: LISTS }, big);
    expect(r1.status).toBe(413);
    expect(JSON.parse(r1.body).error).toBe(TOO_LARGE_MESSAGE);
    const bigBody = deps(
      token(),
      () => new Response("x".repeat(20 * 1024 * 1024 + 1)),
    );
    const r2 = await proxyGoogleRequest({ url: LISTS }, bigBody);
    expect(r2.status).toBe(413);
  });
});
