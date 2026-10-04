// Creates a single-use Google OAuth intent for an authenticated Pro user and
// returns the Google authorize URL. Only the SHA-256 hash of the state is
// stored. Free users connect with their own OAuth client from the desktop app.

import { isProSubscription } from "../_shared/pro.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.3";

const INTENT_TTL_MINUTES = 15;
const SCOPES =
  "openid email https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/drive";

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

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
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

  const { data: subscription } = await supabaseUser
    .from("subscriptions")
    .select("plan, status, current_period_end")
    .maybeSingle();
  if (!isProSubscription(subscription)) {
    return json(
      { error: "Connecting Google through treq needs a Pro plan" },
      403,
    );
  }

  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  if (!clientId) {
    return json({ error: "Google OAuth is not configured" }, 500);
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

  // PKCE: the verifier stays on the intent row (service role only), so a
  // leaked authorization code is useless without it.
  const codeVerifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const codeChallenge = base64Url(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(codeVerifier),
      ),
    ),
  );

  const { error } = await supabase.from("google_oauth_intents").insert({
    user_id: user.id,
    state_hash: await sha256Hex(state),
    code_verifier: codeVerifier,
    expires_at: expiresAt,
  });
  if (error) {
    console.error("[create-google-oauth-intent] insert failed:", error.message);
    return json({ error: "Failed to create OAuth intent" }, 500);
  }

  const redirectUri = `${Deno.env.get("WEB_URL") ?? "https://treq.dev"}/integrations/google/callback`;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  return json({ authorize_url: url.toString(), expires_at: expiresAt });
});
