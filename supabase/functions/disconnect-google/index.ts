// Revokes and deletes the signed-in user's Google grant. Not Pro-gated: a
// user whose plan lapsed must still be able to remove their grant.

import { createClient } from "npm:@supabase/supabase-js@2.95.3";
import { disconnectGoogle, type StoredGrant } from "./lib.ts";

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

  const supabase = createClient(
    supabaseUrl,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const result = await disconnectGoogle({
      fetch,
      store: {
        load: async () => {
          const { data, error } = await supabase
            .from("google_oauth_tokens")
            .select("access_token, refresh_token")
            .eq("user_id", user.id)
            .maybeSingle();
          if (error) throw new Error(error.message);
          return (data as StoredGrant | null) ?? null;
        },
        remove: async () => {
          const { error } = await supabase
            .from("google_oauth_tokens")
            .delete()
            .eq("user_id", user.id);
          if (error) throw new Error(error.message);
        },
      },
    });
    return json(result.body, result.status);
  } catch (err) {
    console.error("[disconnect-google] failed:", String(err));
    return json({ error: "Failed to disconnect Google" }, 500);
  }
});
