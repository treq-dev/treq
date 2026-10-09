import { expect, test, type Browser, type Page } from "@playwright/test";
import pkg from "../../package.json";
import {
  ALPHA_FORM_VERSION,
  alphaSignInHref,
  alphaSourcePage,
  stashPendingJoin,
  takePendingJoin,
} from "../src/lib/alpha";

/** In-memory Storage for testing the pending-join helpers without a browser. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  };
}

test.describe("alpha helpers", () => {
  test("keeps a plain site path from ?from= and falls back to /alpha", () => {
    expect(alphaSourcePage("?from=/roadmap")).toBe("/roadmap");
    expect(alphaSourcePage("")).toBe("/alpha");
    expect(alphaSourcePage("?from=https://evil.com")).toBe("/alpha");
    expect(alphaSourcePage("?from=/roadmap?x=1")).toBe("/alpha");
  });

  test("sends sign-in back to /alpha", () => {
    expect(alphaSignInHref()).toBe("/sign-in?redirect=%2Falpha");
  });

  test("a pending join survives sign-in once, then is gone", () => {
    const storage = memoryStorage();
    expect(stashPendingJoin(storage, "/roadmap", 1_000)).toBe(true);
    expect(takePendingJoin(storage, 2_000)).toEqual({
      formVersion: ALPHA_FORM_VERSION,
      sourcePage: "/roadmap",
      consentedAt: 1_000,
    });
    expect(takePendingJoin(storage, 3_000)).toBeNull();
  });

  test("ignores a stale pending join", () => {
    const storage = memoryStorage();
    stashPendingJoin(storage, "/alpha", 0);
    expect(takePendingJoin(storage, 31 * 60 * 1000)).toBeNull();
  });

  test("ignores a pending join for an older consent wording", () => {
    const storage = memoryStorage();
    storage.setItem(
      "treq.alphaPendingJoin",
      JSON.stringify({ formVersion: "old", sourcePage: "/alpha", consentedAt: 1 }),
    );
    expect(takePendingJoin(storage, 2)).toBeNull();
  });

  test("works without storage", () => {
    expect(stashPendingJoin(undefined, "/alpha")).toBe(false);
    expect(takePendingJoin(undefined)).toBeNull();
    const blocked = memoryStorage();
    blocked.setItem = () => {
      throw new Error("blocked");
    };
    expect(stashPendingJoin(blocked, "/alpha")).toBe(false);
  });
});

async function openAlphaFromFooter(page: Page) {
  await page.goto("/");
  await page.getByRole("contentinfo").getByRole("link", { name: "Private alpha" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Private alpha" })).toBeVisible();
}

test("a signed-out visitor consents on /alpha, then signs in to join", async ({ page }) => {
  await openAlphaFromFooter(page);
  const join = page.getByRole("button", { name: "Sign in to join" });
  await expect(join).toBeDisabled();
  await page.getByRole("checkbox", { name: /Email me alpha invitations/ }).check();
  await join.click();
  await page.waitForURL((url) => url.pathname === "/sign-in");
  expect(new URL(page.url()).searchParams.get("redirect")).toBe("/alpha");
});

const user = {
  id: "8d6f0a52-3c1b-4f4e-9a57-1c2d3e4f5a6b",
  aud: "authenticated",
  role: "authenticated",
  email: "alpha-e2e@treq.dev",
  app_metadata: { provider: "github" },
  user_metadata: {},
  created_at: "2026-10-01T00:00:00Z",
};

function fakeSession() {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return {
    access_token: [
      encode({ alg: "none", typ: "JWT" }),
      encode({ sub: user.id, email: user.email, role: "authenticated", exp: now + 3600 }),
      "e2e",
    ].join("."),
    refresh_token: "e2e-refresh-token",
    expires_in: 3600,
    expires_at: now + 3600,
    token_type: "bearer",
    user,
  };
}

type WaitlistRow = { consented_at: string; unsubscribed_at: string | null };

const SUPABASE_URL = pkg.env.prod.supabase.url;

/** Stub the alpha_waitlist REST endpoint and record every write. */
async function stubWaitlist(page: Page) {
  const writes: unknown[] = [];
  let row: WaitlistRow | null = null;
  await page.route(/\/rest\/v1\/alpha_waitlist/, (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      const wantsObject = (request.headers()["accept"] ?? "").includes("vnd.pgrst.object");
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(wantsObject ? row : row ? [row] : []),
      });
    }
    writes.push(request.postDataJSON());
    row = { consented_at: "2026-10-09T12:00:00Z", unsubscribed_at: null };
    return route.fulfill({ status: 201, body: "" });
  });
  return writes;
}

/**
 * Answer the GitHub OAuth start by sending the browser straight back to the
 * redirect_to URL with a session in the fragment, the way Supabase's implicit
 * flow returns. Supabase's own endpoints answer as the signed-in user.
 */
async function stubOAuth(page: Page) {
  const session = fakeSession();
  await page.route(`${SUPABASE_URL}/auth/v1/authorize**`, (route) => {
    // Production builds return OAuth to https://treq.dev. Keep the round trip
    // on the local server, where the stubs and this tab's storage live.
    const redirectTo = new URL(new URL(route.request().url()).searchParams.get("redirect_to")!);
    redirectTo.protocol = "http:";
    redirectTo.host = "localhost:3000";
    const fragment = new URLSearchParams({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: String(session.expires_in),
      expires_at: String(session.expires_at),
      token_type: "bearer",
    });
    return route.fulfill({ status: 302, headers: { location: `${redirectTo}#${fragment}` } });
  });
  await page.route(`${SUPABASE_URL}/auth/v1/user**`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) }),
  );
  await page.route(`${SUPABASE_URL}/rest/v1/rpc/create_desktop_token`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify("e2e") }),
  );
}

test("consent given before sign-in finishes the join once the visitor is back", async ({
  page,
}) => {
  const writes = await stubWaitlist(page);
  await stubOAuth(page);

  await openAlphaFromFooter(page);
  await page.getByRole("checkbox", { name: /Email me alpha invitations/ }).check();
  await page.getByRole("button", { name: "Sign in to join" }).click();
  await page.waitForURL((url) => url.pathname === "/sign-in");
  await page.getByRole("button", { name: "Continue with GitHub" }).click();
  await page.waitForURL((url) => url.pathname === "/auth/callback" || url.pathname === "/alpha");

  // Until /sign-in honours ?redirect= (#716), the callback page keeps the
  // user there and tries to open the desktop app. The pending consent still
  // completes on their next visit to /alpha in this tab.
  if (new URL(page.url()).pathname !== "/alpha") {
    await openAlphaFromFooter(page);
  }
  await expect(page.getByRole("heading", { name: "You're on the waitlist" })).toBeVisible();
  expect(writes).toEqual([
    {
      user_id: user.id,
      form_version: ALPHA_FORM_VERSION,
      source_page: "/alpha",
      unsubscribed_at: null,
    },
  ]);

  // The pending consent is used once: visiting again does not write again.
  await page.getByRole("contentinfo").getByRole("link", { name: "Roadmap" }).click();
  await page.getByRole("link", { name: "Join the waitlist" }).click();
  await expect(page.getByRole("heading", { name: "You're on the waitlist" })).toBeVisible();
  expect(writes).toHaveLength(1);
});

/** A browser that is already signed in, with the waitlist endpoint stubbed. */
async function signedInPage(browser: Browser) {
  const session = fakeSession();
  const ref = new URL(SUPABASE_URL).hostname.split(".")[0];
  const context = await browser.newContext({
    baseURL: "http://localhost:3000",
    storageState: {
      cookies: [],
      origins: [
        {
          origin: "http://localhost:3000",
          localStorage: [{ name: `sb-${ref}-auth-token`, value: JSON.stringify(session) }],
        },
      ],
    },
  });
  const page = await context.newPage();
  await page.route(`${SUPABASE_URL}/auth/v1/**`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) }),
  );
  const writes = await stubWaitlist(page);
  return { page, writes, close: () => context.close() };
}

test("a signed-in visitor without a pending join ticks consent and joins", async ({
  browser,
}) => {
  const { page, writes, close } = await signedInPage(browser);
  await openAlphaFromFooter(page);
  const join = page.getByRole("button", { name: "Join the alpha" });
  await expect(join).toBeDisabled();
  expect(writes).toHaveLength(0);
  await page.getByRole("checkbox", { name: /Email me alpha invitations/ }).check();
  await join.click();
  await expect(page.getByRole("heading", { name: "You're on the waitlist" })).toBeVisible();
  expect(writes).toHaveLength(1);
  await close();
});
