// Keeps the Rust Linear client supplied with the Supabase session it sends
// to the `linear-proxy` Edge Function. OAuth-connected users have no Linear
// API key on the device; the proxy holds their Linear token and needs the
// treq session to find it. The auto-kickoff poller runs in Rust, so the
// session has to live there too.

import { linearSetProxySession } from "./api-linear";
import { SUPABASE_URL } from "./supabase";
import { createProxySessionSync } from "./supabase-token-sync";

const sync = createProxySessionSync(linearSetProxySession, SUPABASE_URL);

export const ensureLinearProxySessionSync = sync.ensure;
export const resetLinearProxySessionSyncForTests = sync.reset;
