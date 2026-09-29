// Keeps the native SSH pool supplied with the Supabase access token it
// sends to the `remote-ssh-relay` Edge Function. Managed Sprites have no raw
// TCP ingress, so every managed SSH connection opens a WebSocket to that
// relay and authenticates with the user's session token in a header.
//
// The Rust side reads the token when it opens a connection, so this only
// has to keep the latest token there. The desktop Supabase client does not
// refresh tokens in the background (`autoRefreshToken: false`), so a timer
// calls `getSession()`, which refreshes a session close to expiry, and the
// auth listener pushes each new token. The token is never logged.

import { remoteSetRelayAccessToken } from "./api-extra";
import { supabase } from "./supabase";

/** Often enough that a pushed token is never older than the refresh margin supabase-js uses. */
const REFRESH_CHECK_INTERVAL_MS = 60_000;

export interface RelayAuthDeps {
  getAccessToken: () => Promise<string | null>;
  onTokenChange: (listener: (token: string | null) => void) => void;
  pushToken: (token: string | null) => Promise<void>;
  setInterval: (callback: () => void, ms: number) => void;
}

const defaultDeps: RelayAuthDeps = {
  getAccessToken: async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
  onTokenChange: (listener) => {
    supabase.auth.onAuthStateChange((_event, session) =>
      listener(session?.access_token ?? null),
    );
  },
  pushToken: remoteSetRelayAccessToken,
  setInterval: (callback, ms) => {
    setInterval(callback, ms);
  },
};

let started: Promise<void> | null = null;

/**
 * Starts pushing the session token to the native pool, once per app run.
 * Resolves after the first push so the caller's first relayed connection
 * already has a token. Safe to call on every managed connect.
 */
export function ensureRelayAccessTokenSync(
  deps: RelayAuthDeps = defaultDeps,
): Promise<void> {
  if (started) return started;
  let last: string | null | undefined;
  const push = (token: string | null) => {
    if (token === last) return Promise.resolve();
    last = token;
    return deps.pushToken(token).catch(() => {
      // Retried on the next change or timer tick; a missing token shows
      // up as a clear "sign in" connection error in the meantime.
      last = undefined;
    });
  };
  const refresh = () =>
    deps
      .getAccessToken()
      .then(push)
      .catch(() => undefined);
  deps.onTokenChange((token) => void push(token));
  deps.setInterval(() => void refresh(), REFRESH_CHECK_INTERVAL_MS);
  started = refresh();
  return started;
}

/** Test-only: forget that sync was started. */
export function resetRelayAccessTokenSyncForTests(): void {
  started = null;
}
