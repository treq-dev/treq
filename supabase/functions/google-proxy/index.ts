// Forwards an authenticated Google Tasks or Drive request using the user's
// stored grant from google_oauth_tokens, refreshing it near expiry. The
// request logic lives in lib.ts so it can be unit tested.

import { createClient } from "npm:@supabase/supabase-js@2.95.3";
import {
  proxyGoogleRequest,
  type ProxyRequest,
  type StoredToken,
  TREQ_SESSION_UNAUTHORIZED,
} from "./lib.ts";

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
  if (!userToken) return json(TREQ_SESSION_UNAUTHORIZED, 401);

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
  if (authError || !user) return json(TREQ_SESSION_UNAUTHORIZED, 401);

  let body: ProxyRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const supabase = createClient(
    supabaseUrl,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");

  const result = await proxyGoogleRequest(body, {
    fetch,
    isPro: async () => {
      const { data, error } = await supabaseUser
        .from("subscriptions")
        .select("plan, status")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data?.plan === "pro" && data?.status === "active";
    },
    googleClient:
      clientId && clientSecret ? { id: clientId, secret: clientSecret } : null,
    store: {
      load: async () => {
        const { data, error } = await supabase
          .from("google_oauth_tokens")
          .select("access_token, refresh_token, expires_at, updated_at")
          .eq("user_id", user.id)
          .maybeSingle();
        if (error) throw new Error(error.message);
        return (data as StoredToken | null) ?? null;
      },
      save: async (update) => {
        const { error } = await supabase
          .from("google_oauth_tokens")
          .update({ ...update, updated_at: new Date().toISOString() })
          .eq("user_id", user.id);
        if (error) throw new Error(error.message);
      },
    },
  });
  return new Response(result.body, {
    status: result.status,
    headers: { ...corsHeaders, "Content-Type": result.contentType },
  });
});
