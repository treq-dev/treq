import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type AuthCallbackUrlOptions = {
  siteUrl: string;
  browserOrigin: string;
  isProduction: boolean;
  query?: string;
};

/** Build an auth callback URL without relying on the deployment server's origin. */
export function getAuthCallbackUrl({
  siteUrl,
  browserOrigin,
  isProduction,
  query,
}: AuthCallbackUrlOptions): string {
  const origin = (isProduction ? siteUrl : browserOrigin).replace(/\/$/, "");
  return `${origin}/auth/callback${query ? `?${query}` : ""}`;
}

const DEFAULT_REDIRECT_PATH = "/dashboard";

const REDIRECT_CHECK_ORIGIN = "https://redirect-check.invalid";

/**
 * Return `target` as a path on this site, or `/dashboard` when it is not one.
 * Only a path with one leading `/` passes, so `//host`, `https:` and
 * `javascript:` targets cannot send a user off the site after sign-in.
 */
export function safeRedirectPath(target: string | null | undefined): string {
  if (
    !target ||
    !target.startsWith("/") ||
    target.startsWith("//") ||
    target.includes("\\") ||
    // Browsers drop tabs and newlines from URLs, so "/\t/evil.com" would
    // become "//evil.com".
    /[\u0000-\u001f\u007f]/.test(target)
  ) {
    return DEFAULT_REDIRECT_PATH;
  }
  // Resolve against a fixed origin as a final check that the host cannot change.
  const url = new URL(target, REDIRECT_CHECK_ORIGIN);
  if (url.origin !== REDIRECT_CHECK_ORIGIN) return DEFAULT_REDIRECT_PATH;
  return `${url.pathname}${url.search}${url.hash}`;
}
