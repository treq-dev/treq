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
