// Proxies authenticated Linear API requests to the Linear GraphQL endpoint.
// The client sends a GraphQL query/mutation, and this function forwards it
// using the stored access token from linear_oauth_tokens. An access token
// close to expiry is refreshed first and the new grant is stored.

import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Refresh a little early so the token cannot expire mid-request.
const REFRESH_MARGIN_MS = 60_000;
const RECONNECT_MESSAGE =
  "Linear authorization expired. Reconnect Linear in treq settings.";

type StoredToken = {
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  updated_at: string;
};

type SupabaseAdmin = SupabaseClient;

function needsRefresh(token: StoredToken, now = Date.now()): boolean {
  if (!token.expires_at) return false;
  return Date.parse(token.expires_at) - now < REFRESH_MARGIN_MS;
}

async function loadToken(
  supabase: SupabaseAdmin,
  userId: string,
): Promise<{ token: StoredToken | null; error: string | null }> {
  const { data, error } = await supabase
    .from("linear_oauth_tokens")
    .select("access_token, refresh_token, expires_at, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  return {
    token: (data as StoredToken | null) ?? null,
    error: error?.message ?? null,
  };
}

// Returns a usable access token, or null when the user must reconnect.
async function refreshToken(
  supabase: SupabaseAdmin,
  userId: string,
  token: StoredToken,
): Promise<string | null> {
  const clientId = Deno.env.get("LINEAR_CLIENT_ID");
  const clientSecret = Deno.env.get("LINEAR_CLIENT_SECRET");
  if (!token.refresh_token || !clientId || !clientSecret) return null;

  const res = await fetch("https://api.linear.app/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: token.refresh_token,
      grant_type: "refresh_token",
    }).toString(),
  });

  if (!res.ok) {
    console.error("[linear-proxy] token refresh failed:", res.status);
    // A concurrent request may have refreshed first, which spends the
    // refresh token this request used. Use its result if there is one.
    const { token: latest } = await loadToken(supabase, userId);
    if (
      latest && latest.updated_at !== token.updated_at && !needsRefresh(latest)
    ) {
      return latest.access_token;
    }
    return null;
  }

  const grant = await res.json();
  if (!grant.access_token) return null;
  const { error } = await supabase
    .from("linear_oauth_tokens")
    .update({
      access_token: grant.access_token,
      refresh_token: grant.refresh_token ?? token.refresh_token,
      expires_at: grant.expires_in
        ? new Date(Date.now() + grant.expires_in * 1000).toISOString()
        : null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  if (error) {
    console.error(
      "[linear-proxy] storing refreshed token failed:",
      error.message,
    );
  }
  return grant.access_token as string;
}

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

  const { token, error: tokenError } = await loadToken(supabase, user.id);

  if (tokenError) {
    console.error("[linear-proxy] token lookup failed:", tokenError);
    return json({ error: "Failed to retrieve Linear token" }, 500);
  }

  if (!token) {
    return json({ error: "Linear account not linked" }, 403);
  }

  let accessToken = token.access_token;
  if (needsRefresh(token)) {
    const refreshed = await refreshToken(supabase, user.id, token).catch(
      (err) => {
        console.error(
          "[linear-proxy] token refresh error:",
          err instanceof Error ? err.message : String(err),
        );
        return null;
      },
    );
    if (!refreshed) return json({ error: RECONNECT_MESSAGE }, 401);
    accessToken = refreshed;
  }

  try {
    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // OAuth tokens need the Bearer scheme; only personal API keys are
        // sent bare.
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        query: body.query,
        variables: body.variables,
      }),
    });

    if (response.status === 401) {
      return json({ error: RECONNECT_MESSAGE }, 401);
    }

    // Pass Linear's body through, including GraphQL `errors` on a 4xx, so
    // the desktop app can show Linear's own message.
    const text = await response.text();
    if (!response.ok) {
      console.error("[linear-proxy] Linear API error:", response.status);
    }
    return new Response(text, {
      status: response.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(
      "[linear-proxy] request failed:",
      err instanceof Error ? err.message : String(err),
    );
    return json({ error: "Failed to proxy Linear request" }, 502);
  }
});
