// Proxies authenticated Linear API requests to the Linear GraphQL endpoint.
// The client sends a GraphQL query/mutation, and this function forwards it
// using the stored access token from linear_oauth_tokens.

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

  let body: { query?: string; variables?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (!body.query) {
    return json({ error: "Missing query" }, 400);
  }

  const supabase = createClient(
    supabaseUrl,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const { data: tokenData, error: tokenError } = await supabase
    .from("linear_oauth_tokens")
    .select("access_token")
    .eq("user_id", user.id)
    .maybeSingle();

  if (tokenError) {
    console.error("[linear-proxy] token lookup failed:", tokenError.message);
    return json({ error: "Failed to retrieve Linear token" }, 500);
  }

  if (!tokenData) {
    return json({ error: "Linear account not linked" }, 403);
  }

  try {
    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": tokenData.access_token,
      },
      body: JSON.stringify({
        query: body.query,
        variables: body.variables,
      }),
    });

    if (!response.ok) {
      console.error(
        "[linear-proxy] Linear API error:",
        response.status,
      );
      return json(
        { error: "Linear API error", status: response.status },
        response.status,
      );
    }

    const result = await response.json();
    return json(result);
  } catch (err) {
    console.error(
      "[linear-proxy] request failed:",
      err instanceof Error ? err.message : String(err),
    );
    return json({ error: "Failed to proxy Linear request" }, 502);
  }
});
