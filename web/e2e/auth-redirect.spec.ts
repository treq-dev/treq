import { expect, test, type Page } from "@playwright/test";
import pkg from "../../package.json";
import { getAuthCallbackUrl, safeRedirectPath } from "../src/lib/utils";

test("uses the configured site URL for production auth callbacks", () => {
  expect(
    getAuthCallbackUrl({
      siteUrl: "https://treq.dev",
      browserOrigin: "http://localhost:3000",
      isProduction: true,
      query: "source=desktop",
    }),
  ).toBe("https://treq.dev/auth/callback?source=desktop");
});

test("uses the browser origin while developing locally", () => {
  expect(
    getAuthCallbackUrl({
      siteUrl: "https://treq.dev",
      browserOrigin: "http://localhost:3001",
      isProduction: false,
      query: "type=recovery",
    }),
  ).toBe("http://localhost:3001/auth/callback?type=recovery");
});

test.describe("safeRedirectPath", () => {
  for (const path of [
    "/dashboard",
    "/dashboard?tab=integrations",
    "/integrations/github/callback?installation_id=1&state=abc",
    "/docs#install",
  ]) {
    test(`keeps the same-origin path ${path}`, () => {
      expect(safeRedirectPath(path)).toBe(path);
    });
  }

  for (const target of [
    null,
    undefined,
    "",
    "dashboard",
    "//evil.com",
    "//evil.com/dashboard",
    "/\\evil.com",
    "\\\\evil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    "https://evil.com",
    "https://treq.dev/dashboard",
    "javascript:alert(1)",
    " /dashboard",
  ]) {
    test(`falls back to /dashboard for ${JSON.stringify(target)}`, () => {
      expect(safeRedirectPath(target)).toBe("/dashboard");
    });
  }
});

/** Click an OAuth button on /sign-in and return the callback URL sent to Supabase. */
async function oauthCallbackUrl(page: Page, search: string): Promise<URL> {
  await page.route("**/auth/v1/authorize**", (route) => route.abort());
  await page.goto(`/sign-in${search}`);
  const authorize = page.waitForRequest("**/auth/v1/authorize**");
  await page.getByRole("button", { name: "Continue with GitHub" }).click();
  const redirectTo = new URL((await authorize).url()).searchParams.get("redirect_to");
  expect(redirectTo).not.toBeNull();
  return new URL(redirectTo!);
}

test.describe("/sign-in OAuth callback URL", () => {
  test("carries a same-origin redirect to the callback", async ({ page }) => {
    const url = await oauthCallbackUrl(
      page,
      `?redirect=${encodeURIComponent("/dashboard?tab=integrations")}`,
    );
    expect(url.pathname).toBe("/auth/callback");
    expect(url.searchParams.get("redirect")).toBe("/dashboard?tab=integrations");
    expect(url.searchParams.get("source")).toBeNull();
  });

  for (const target of ["//evil.com", "https://evil.com"]) {
    test(`replaces the unsafe redirect ${target} with /dashboard`, async ({ page }) => {
      const url = await oauthCallbackUrl(page, `?redirect=${encodeURIComponent(target)}`);
      expect(url.searchParams.get("redirect")).toBe("/dashboard");
    });
  }

  test("keeps the desktop callback URL unchanged", async ({ page }) => {
    const url = await oauthCallbackUrl(page, "?source=desktop");
    expect(url.pathname).toBe("/auth/callback");
    expect(url.search).toBe("?source=desktop");
  });
});

test("GitHub App callback sends signed-out users to sign-in with a relative redirect", async ({
  page,
}) => {
  await page.goto("/integrations/github/callback?installation_id=1&state=abc");
  await expect(page.locator('a[href^="/sign-in?redirect="]')).toHaveAttribute(
    "href",
    `/sign-in?redirect=${encodeURIComponent("/integrations/github/callback?installation_id=1&state=abc")}`,
  );
});

const SUPABASE_URL = pkg.env.prod.supabase.url;

/**
 * Answer the Supabase calls /auth/callback makes so an OAuth return can be
 * replayed without a real provider. Returns the desktop-token RPC calls seen.
 */
async function fakeSupabase(page: Page): Promise<string[]> {
  const tokenCalls: string[] = [];
  await page.route(`${SUPABASE_URL}/**`, (route) => route.abort());
  await page.route(`${SUPABASE_URL}/auth/v1/user`, (route) =>
    route.fulfill({
      json: {
        id: "00000000-0000-4000-8000-000000000001",
        aud: "authenticated",
        role: "authenticated",
        email: "e2e@example.com",
        app_metadata: { provider: "github" },
        user_metadata: {},
        created_at: "2026-01-01T00:00:00Z",
      },
    }),
  );
  await page.route(`${SUPABASE_URL}/rest/v1/rpc/create_desktop_token`, (route) => {
    tokenCalls.push(route.request().url());
    return route.fulfill({ json: "desktop-token" });
  });
  return tokenCalls;
}

/** The URL fragment Supabase appends when an implicit OAuth sign-in returns. */
function oauthReturnHash(): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const accessToken = [
    encode({ alg: "HS256", typ: "JWT" }),
    encode({ sub: "00000000-0000-4000-8000-000000000001", role: "authenticated", exp }),
    "signature",
  ].join(".");
  return `#${new URLSearchParams({
    access_token: accessToken,
    expires_at: String(exp),
    expires_in: "3600",
    refresh_token: "fake-refresh-token",
    token_type: "bearer",
  })}`;
}

test.describe("/auth/callback after OAuth", () => {
  test("web sign-in goes to the redirect target without a desktop token", async ({ page }) => {
    const tokenCalls = await fakeSupabase(page);
    await page.goto(
      `/auth/callback?redirect=${encodeURIComponent("/dashboard?tab=integrations")}${oauthReturnHash()}`,
    );
    await page.waitForURL("**/dashboard?tab=integrations", { waitUntil: "commit" });
    expect(tokenCalls).toHaveLength(0);
  });

  test("web sign-in ignores an off-site redirect", async ({ page }) => {
    await fakeSupabase(page);
    await page.goto(
      `/auth/callback?redirect=${encodeURIComponent("//evil.com")}${oauthReturnHash()}`,
    );
    await page.waitForURL((url) => url.pathname === "/dashboard" && url.search === "", {
      waitUntil: "commit",
    });
  });

  test("desktop sign-in still hands a token to the app", async ({ page }) => {
    const tokenCalls = await fakeSupabase(page);
    await page.goto(`/auth/callback?source=desktop${oauthReturnHash()}`);
    await expect(page.getByRole("link", { name: "Open Treq" })).toHaveAttribute(
      "href",
      "treq://auth/callback?token=desktop-token",
    );
    expect(tokenCalls).toHaveLength(1);
  });
});
