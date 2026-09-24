// Creates a single-use Linear OAuth intent for the authenticated user and returns
// the opaque state to append to the Linear OAuth authorize URL. Only the
// SHA-256 hash of the state is stored.

import { createClient } from "npm:@supabase/supabase-js@2.95.3";

const INTENT_TTL_MINUTES = 15;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const userToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!userToken) return json({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseUser = createClient(
    supabaseUrl,
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${userToken}` } } },
  );
  const {
    data: { user },
    error: authError,
  } = await supabaseUser.auth.getUser();
  if (authError || !user) return json({ error: "Unauthorized" }, 401);

  const linearClientId = Deno.env.get("LINEAR_CLIENT_ID");
  if (!linearClientId) {
    return json({ error: "Linear OAuth is not configured" }, 500);
  }

  const supabase = createClient(
    supabaseUrl,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const stateBytes = crypto.getRandomValues(new Uint8Array(32));
  const state = Array.from(stateBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const expiresAt = new Date(
    Date.now() + INTENT_TTL_MINUTES * 60 * 1000,
  ).toISOString();

  const { error } = await supabase.from("linear_oauth_intents").insert({
    user_id: user.id,
    state_hash: await sha256Hex(state),
    expires_at: expiresAt,
  });
  if (error) {
    console.error("[create-linear-oauth-intent] insert failed:", error.message);
    return json({ error: "Failed to create OAuth intent" }, 500);
  }

  const redirectUri = `${Deno.env.get("WEB_URL") ?? "https://treq.dev"}/integrations/linear/callback`;
  const authorizationUrl = new URL("https://linear.app/oauth/authorize");
  authorizationUrl.searchParams.set("client_id", linearClientId);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", "read,write");
  authorizationUrl.searchParams.set("state", state);

  return json({
    authorization_url: authorizationUrl.toString(),
    expires_at: expiresAt,
  });
});
