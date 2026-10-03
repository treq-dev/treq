// Keeps the Rust Google client supplied with the Supabase session it sends to
// the `google-proxy` Edge Function. Pro users connect Google through treq's
// OAuth app; the proxy holds their Google grant and needs the treq session
// to find it.

import { googleSetProxySession } from "./api-google";
import { SUPABASE_URL } from "./supabase";
import {
  type AccessTokenSyncDeps,
  startAccessTokenSync,
  supabaseTokenDeps,
} from "./supabase-token-sync";

let started: Promise<void> | null = null;

/** Starts the sync once per app run and resolves after the first push. */
export function ensureGoogleProxySessionSync(
  deps: AccessTokenSyncDeps = supabaseTokenDeps((token) =>
    googleSetProxySession(token ? SUPABASE_URL : null, token),
  ),
): Promise<void> {
  if (started) return started;
  started = startAccessTokenSync(deps);
  return started;
}
