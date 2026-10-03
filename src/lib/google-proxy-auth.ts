// Keeps the Rust Google client supplied with the Supabase session it sends to
// the `google-proxy` Edge Function, which holds Pro users' Google grants.

import { googleSetProxySession } from "./api-google";
import { SUPABASE_URL } from "./supabase";
import { createProxySessionSync } from "./supabase-token-sync";

export const ensureGoogleProxySessionSync = createProxySessionSync(
  googleSetProxySession,
  SUPABASE_URL,
).ensure;
