// Sign-in callback handling for the mobile app. The web sign-in page ends
// by opening `treq://auth/callback?token=...`; the app exchanges that
// one-time token for a Supabase session (`useAuthStore.exchangeToken`).
//
// Desktop listens for `deep-link-received` events (see `AppStoreEffects`),
// which come from a Rust handler that only exists on desktop. On Android and iOS the
// deep-link plugin delivers links straight to the frontend: `getCurrent`
// returns the link that launched the app, and `onOpenUrl` reports links
// that arrive while it runs. The `treq` scheme is registered for mobile in
// `src-tauri/tauri.conf.json` (`plugins.deep-link.mobile`).

import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";

/** The sign-in token from the first auth callback URL in `urls`, if any. */
export function authCallbackToken(urls: readonly string[]): string | null {
  for (const raw of urls) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    // `treq://auth/callback` parses with `auth` as the host.
    const isCallback =
      url.protocol === "treq:" &&
      `${url.host}${url.pathname}` === "auth/callback";
    const token = isCallback ? url.searchParams.get("token") : null;
    if (token) return token;
  }
  return null;
}

// A token is single-use, and `getCurrent` keeps returning the launch link
// for the life of the process, so tokens already handled are skipped.
const handledTokens = new Set<string>();

/** Calls `onToken` once for each new sign-in token delivered by a deep link. */
export async function listenForAuthCallbacks(
  onToken: (token: string) => void,
): Promise<() => void> {
  const handle = (urls: readonly string[] | null) => {
    const token = urls ? authCallbackToken(urls) : null;
    if (!token || handledTokens.has(token)) return;
    handledTokens.add(token);
    onToken(token);
  };
  const unlisten = await onOpenUrl(handle);
  handle(await getCurrent().catch(() => null));
  return unlisten;
}
