// Keeps the Rust proxy clients supplied with the Supabase session they send
// to the `linear-proxy` and `google-proxy` Edge Functions. OAuth-connected
// users have no Linear or Google token on the device; the proxies hold them
// and need the treq session to find them. The Linear auto-kickoff poller runs
// in Rust, so the session has to live there too.

import { setProxySession } from "./api-tracker";
import { SUPABASE_URL } from "./supabase";
import { createProxySessionSync } from "./supabase-token-sync";

const sync = createProxySessionSync(setProxySession, SUPABASE_URL);

export const ensureProxySessionSync = sync.ensure;
export const resetProxySessionSyncForTests = sync.reset;
