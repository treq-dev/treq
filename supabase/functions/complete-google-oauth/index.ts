// Completes the Google OAuth flow: verifies the single-use intent state
// belongs to the authenticated user, exchanges the code, and stores the grant.

import { createClient } from "npm:@supabase/supabase-js@2.95.3";

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

// The id_token came straight from Google's token endpoint over TLS, so its
// payload is read without verifying the signature.
function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== "string") return null;
  try {
    const payload = idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(payload)).email ?? null;
  } catch {
    return null;
  }
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

  let body: { code?: string; state?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const { code, state } = body;
  if (!code || !state) return json({ error: "Missing code or state" }, 400);

  const supabase = createClient(
    supabaseUrl,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const stateHash = await sha256Hex(state);
  const { data: intent, error: intentError } = await supabase
    .from("google_oauth_intents")
    .update({ consumed_at: new Date().toISOString() })
    .eq("state_hash", stateHash)
    .eq("user_id", user.id)
    .is("consumed_at", null)
    .gte("expires_at", new Date().toISOString())
    .select("id, code_verifier")
    .maybeSingle();
  if (intentError) {
    console.error(
      "[complete-google-oauth] intent lookup failed:",
      intentError.message,
    );
    return json({ error: "Failed to verify OAuth intent" }, 500);
  }
  if (!intent) {
    // A state that exists but belongs to someone else means the callback URL
    // leaked. Burn the intent so its owner's code can't be redeemed later.
    const { error: burnError } = await supabase
      .from("google_oauth_intents")
      .update({ consumed_at: new Date().toISOString() })
      .eq("state_hash", stateHash)
      .neq("user_id", user.id)
      .is("consumed_at", null);
    if (burnError) {
      console.error(
        "[complete-google-oauth] burning foreign intent failed:",
        burnError.message,
      );
    }
    return json(
      { error: "OAuth intent is invalid, expired or already used" },
      403,
    );
  }

  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    return json({ error: "Google OAuth is not configured" }, 500);
  }

  const redirectUri = `${Deno.env.get("WEB_URL") ?? "https://treq.dev"}/integrations/google/callback`;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      ...(intent.code_verifier ? { code_verifier: intent.code_verifier } : {}),
    }).toString(),
  }).catch(() => null);
  if (!tokenRes?.ok) {
    console.error(
      "[complete-google-oauth] token exchange failed:",
      tokenRes?.status,
    );
    return json({ error: "Failed to exchange authorization code" }, 502);
  }
  const grant = await tokenRes.json();
  if (!grant.access_token) {
    return json({ error: "No access token in Google response" }, 502);
  }

  const email = emailFromIdToken(grant.id_token);
  const { error: storeError } = await supabase
    .from("google_oauth_tokens")
    .upsert(
      {
        user_id: user.id,
        access_token: grant.access_token,
        refresh_token: grant.refresh_token ?? null,
        expires_at: grant.expires_in
          ? new Date(Date.now() + grant.expires_in * 1000).toISOString()
          : null,
        google_email: email,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  if (storeError) {
    console.error("[complete-google-oauth] store failed:", storeError.message);
    return json({ error: "Failed to store Google token" }, 500);
  }

  return json({ success: true, email });
});
