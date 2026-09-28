// Keeps the Rust Linear client supplied with the Supabase session it sends
// to the `linear-proxy` Edge Function. OAuth-connected users have no Linear
// API key on the device; the proxy holds their Linear token and needs the
// treq session to find it. The auto-kickoff poller runs in Rust, so the
// session has to live there too.

import { linearSetProxySession } from "./api-linear";
import { SUPABASE_URL } from "./supabase";
import {
  type AccessTokenSyncDeps,
  startAccessTokenSync,
  supabaseTokenDeps,
} from "./supabase-token-sync";

let started: Promise<void> | null = null;

/** Starts the sync once per app run and resolves after the first push. */
export function ensureLinearProxySessionSync(
  deps: AccessTokenSyncDeps = supabaseTokenDeps((token) =>
    linearSetProxySession(token ? SUPABASE_URL : null, token),
  ),
): Promise<void> {
  if (started) return started;
  started = startAccessTokenSync(deps);
  return started;
}

/** Test-only: forget that sync was started. */
export function resetLinearProxySessionSyncForTests(): void {
  started = null;
}
