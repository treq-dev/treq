// Completes the GitHub App installation flow: verifies the single-use intent
// state belongs to the authenticated user, confirms the installation exists
// on GitHub via app-level auth, links it, and consumes the intent.
//
// A browser-supplied installation_id alone never determines ownership.

import { createClient } from "npm:@supabase/supabase-js@2.95.3";
import { getInstallation } from "../_shared/merge-queue/github-adapter.ts";

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

  let body: { installation_id?: number; state?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const installationId = Number(body.installation_id);
  const state = body.state;
  if (!Number.isInteger(installationId) || installationId <= 0 || !state) {
    return json({ error: "Missing installation_id or state" }, 400);
  }

  const supabase = createClient(
    supabaseUrl,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  // Atomically consume the intent: single-use, unexpired, owned by the
  // caller. Consuming before the GitHub lookup prevents concurrent reuse.
  const stateHash = await sha256Hex(state);
  const { data: intent, error: intentError } = await supabase
    .from("github_install_intents")
    .update({ consumed_at: new Date().toISOString() })
    .eq("state_hash", stateHash)
    .eq("user_id", user.id)
    .is("consumed_at", null)
    .gte("expires_at", new Date().toISOString())
    .select("id")
    .maybeSingle();
  if (intentError) {
    console.error("[complete-github-installation] intent lookup failed:", intentError.message);
    return json({ error: "Failed to verify install intent" }, 500);
  }
  if (!intent) {
    return json({ error: "Install intent is invalid, expired or already used" }, 403);
  }

  // Verify the installation actually exists for our app on GitHub's side.
  let installation;
  try {
    installation = await getInstallation(installationId);
  } catch (err) {
    console.error(
      "[complete-github-installation] GitHub lookup failed:",
      err instanceof Error ? err.message : String(err),
    );
    return json({ error: "Failed to verify installation with GitHub" }, 502);
  }
  if (!installation) {
    return json({ error: "Installation not found on GitHub" }, 404);
  }

  const { error: linkError } = await supabase
    .from("github_app_installations")
    .upsert(
      {
        id: installation.id,
        account_login: installation.account.login,
        account_type: installation.account.type,
        account_avatar_url: installation.account.avatar_url ?? null,
        app_id: installation.app_id,
        linked_user_id: user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
  if (linkError) {
    console.error("[complete-github-installation] link failed:", linkError.message);
    return json({ error: "Failed to link installation" }, 500);
  }

  console.log(
    JSON.stringify({
      operation: "installation_linked",
      installation_id: installation.id,
      account_login: installation.account.login,
      user_id: user.id,
    }),
  );

  return json({ ok: true, account_login: installation.account.login });
});
