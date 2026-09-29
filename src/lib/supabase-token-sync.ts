// Keeps a native (Rust) consumer supplied with the signed-in user's Supabase
// access token. The desktop Supabase client does not refresh tokens in the
// background (`autoRefreshToken: false`), so a timer calls `getSession()`,
// which refreshes a session close to expiry, and the auth listener pushes
// each new token. The token is never logged.

import { supabase } from "./supabase";

/** Often enough that a pushed token is never older than the refresh margin supabase-js uses. */
const REFRESH_CHECK_INTERVAL_MS = 60_000;

export interface AccessTokenSyncDeps {
  getAccessToken: () => Promise<string | null>;
  onTokenChange: (listener: (token: string | null) => void) => void;
  pushToken: (token: string | null) => Promise<void>;
  setInterval: (callback: () => void, ms: number) => void;
}

export function supabaseTokenDeps(
  pushToken: (token: string | null) => Promise<void>,
): AccessTokenSyncDeps {
  return {
    getAccessToken: async () => {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    },
    onTokenChange: (listener) => {
      supabase.auth.onAuthStateChange((_event, session) =>
        listener(session?.access_token ?? null),
      );
    },
    pushToken,
    setInterval: (callback, ms) => {
      setInterval(callback, ms);
    },
  };
}

/**
 * Starts pushing the token and resolves after the first push. Callers keep
 * their own once-per-run guard.
 */
export function startAccessTokenSync(deps: AccessTokenSyncDeps): Promise<void> {
  let last: string | null | undefined;
  const push = (token: string | null) => {
    if (token === last) return Promise.resolve();
    last = token;
    return deps.pushToken(token).catch(() => {
      // Retried on the next change or timer tick; a missing token shows
      // up as a clear "sign in" error in the meantime.
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
  return refresh();
}
