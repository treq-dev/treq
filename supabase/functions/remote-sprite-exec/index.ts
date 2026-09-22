// Authenticated, ownership-checked command execution for a user's managed
// Sprite. The organization token remains inside the Edge Function.

import { createClient } from "npm:@supabase/supabase-js@2.95.3";
import { SpritesClient } from "npm:@fly/sprites@0.2.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("authorization") ?? "";
  const userToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!userToken) return json({ error: "Unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${userToken}` } },
  });
  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();
  if (authError || !user) return json({ error: "Unauthorized" }, 401);

  const body = (await req.json().catch(() => null)) as {
    instance_id?: string;
    argv?: unknown;
    cwd?: unknown;
    timeout_ms?: unknown;
  } | null;
  if (
    !body ||
    !Array.isArray(body.argv) ||
    !body.argv.every((arg) => typeof arg === "string")
  ) {
    return json({ error: "argv must be an array of strings" }, 400);
  }
  if (body.argv.length === 0 || body.argv[0] !== "treq") {
    return json({ error: "Only typed Treq CLI commands are allowed" }, 400);
  }

  const admin = createClient(url, serviceKey);
  let query = admin
    .from("remote_instances")
    .select("id, provider_resource_id, status")
    .eq("owner_user_id", user.id)
    .neq("status", "deleted");
  if (body.instance_id) query = query.eq("id", body.instance_id);
  const { data: instance, error } = await query.maybeSingle();
  if (error || !instance?.provider_resource_id)
    return json({ error: "Managed Sprite not found" }, 404);

  const token =
    Deno.env.get("SPRITES_API_TOKEN") ?? Deno.env.get("FLY_SPRITES_API_TOKEN");
  const baseURL =
    Deno.env.get("SPRITES_API_URL") ?? Deno.env.get("FLY_SPRITES_API_BASE_URL");
  if (!token || !baseURL)
    return json({ error: "Sprites provider is not configured" }, 503);

  try {
    const timeout =
      typeof body.timeout_ms === "number"
        ? Math.min(Math.max(body.timeout_ms, 1_000), 120_000)
        : 30_000;
    const client = new SpritesClient(token, { baseURL, timeout });
    const result = await client
      .sprite(instance.provider_resource_id)
      .execFile(body.argv[0], body.argv.slice(1), {
        cwd: typeof body.cwd === "string" ? body.cwd : undefined,
        timeout,
        maxBuffer: 10 * 1024 * 1024,
      });
    return json({
      exit_code: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  } catch (err) {
    return json(
      { error: `Sprite command failed: ${(err as Error).message}` },
      502,
    );
  }
});
