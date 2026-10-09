import { expect, test } from "@playwright/test";
import {
  authCallbackDestination,
  getAuthCallbackUrl,
  safeRedirectPath,
  signInCallbackQuery,
  signInHrefFor,
} from "../src/lib/utils";

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

test.describe("signInCallbackQuery", () => {
  test("carries a same-origin redirect to the callback", () => {
    expect(signInCallbackQuery("", "/dashboard?tab=integrations")).toBe(
      `redirect=${encodeURIComponent("/dashboard?tab=integrations")}`,
    );
  });

  for (const target of ["//evil.com", "https://evil.com"]) {
    test(`replaces the unsafe redirect ${target} with /dashboard`, () => {
      expect(signInCallbackQuery("", target)).toBe("redirect=%2Fdashboard");
    });
  }

  test("keeps the desktop callback query unchanged", () => {
    expect(signInCallbackQuery("desktop", null)).toBe("source=desktop");
  });

  test("adds nothing when no redirect was requested", () => {
    expect(signInCallbackQuery("", null)).toBeUndefined();
  });
});

test.describe("authCallbackDestination", () => {
  test("sends web sign-ins to the redirect target", () => {
    const params = new URLSearchParams({ redirect: "/dashboard?tab=integrations" });
    expect(authCallbackDestination(params)).toEqual({
      kind: "web",
      path: "/dashboard?tab=integrations",
    });
  });

  test("ignores an off-site redirect", () => {
    const params = new URLSearchParams({ redirect: "//evil.com" });
    expect(authCallbackDestination(params)).toEqual({ kind: "web", path: "/dashboard" });
  });

  test("hands desktop sign-ins a token", () => {
    const params = new URLSearchParams({ source: "desktop", redirect: "/dashboard" });
    expect(authCallbackDestination(params)).toEqual({ kind: "desktop" });
  });
});

test("signInHrefFor returns the user to the page they were on", () => {
  expect(signInHrefFor("/integrations/github/callback?installation_id=1&state=abc")).toBe(
    `/sign-in?redirect=${encodeURIComponent("/integrations/github/callback?installation_id=1&state=abc")}`,
  );
});

test("the navbar sign-in link sends GitHub OAuth back to /auth/callback", async ({ page }) => {
  await page.route("**/auth/v1/authorize**", (route) => route.abort());
  await page.goto("/");
  await page.getByRole("link", { name: "Sign in" }).first().click();
  const authorize = page.waitForRequest("**/auth/v1/authorize**");
  await page.getByRole("button", { name: "Continue with GitHub" }).click();
  const redirectTo = new URL((await authorize).url()).searchParams.get("redirect_to");
  expect(redirectTo).not.toBeNull();
  const url = new URL(redirectTo!);
  expect(url.pathname).toBe("/auth/callback");
  expect(url.search).toBe("");
});
