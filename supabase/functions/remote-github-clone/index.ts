import { createClient } from "npm:@supabase/supabase-js@2.95.3";
import { getInstallationToken } from "../_shared/merge-queue/github-adapter.ts";
import {
  buildCloneCommand,
  redactCloneFailure,
} from "../_shared/remote/github-clone.ts";
import {
  ProviderError,
  SpritesProvider,
  spritesConfigFromEnv,
} from "../_shared/remote/sprites-adapter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function response(
  correlationId: string,
  status: number,
  body: Record<string, unknown>,
): Response {
  return Response.json(
    { ...body, correlation_id: correlationId },
    {
      status,
      headers: { ...corsHeaders, "X-Correlation-Id": correlationId },
    },
  );
}

function failure(
  correlationId: string,
  status: number,
  code: string,
  error: string,
): Response {
  return response(correlationId, status, { code, error });
}

Deno.serve(async (req) => {
  const correlationId = crypto.randomUUID();
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return failure(
      correlationId,
      405,
      "method_not_allowed",
      "Method not allowed",
    );
  }

  const bearer = (req.headers.get("authorization") ?? "").replace(
    /^Bearer\s+/i,
    "",
  );
  if (!bearer)
    return failure(correlationId, 401, "unauthorized", "Unauthorized");

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const userClient = createClient(
    url,
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    },
  );
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) return failure(correlationId, 401, "unauthorized", "Unauthorized");

  const body = (await req.json().catch(() => null)) as {
    instance_id?: unknown;
    repo_full_name?: unknown;
  } | null;
  if (
    !body ||
    typeof body.instance_id !== "string" ||
    typeof body.repo_full_name !== "string" ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(body.repo_full_name)
  ) {
    return failure(
      correlationId,
      400,
      "invalid_request",
      "instance_id and canonical repo_full_name are required",
    );
  }

  const admin = createClient(
    url,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const { data: instance } = await admin
    .from("remote_instances")
    .select("id, provider_resource_id, status")
    .eq("id", body.instance_id)
    .eq("owner_user_id", user.id)
    .neq("status", "deleted")
    .maybeSingle();
  if (!instance?.provider_resource_id) {
    return failure(
      correlationId,
      404,
      "instance_not_found",
      "Managed Sprite not found",
    );
  }
  if (instance.status === "suspended" || instance.status === "waking") {
    return failure(
      correlationId,
      409,
      "sprite_suspended",
      "Wake the Sprite before cloning",
    );
  }

  const { data: repository } = await admin
    .from("github_repositories")
    .select("id, owner, name, full_name, installation_id")
    .eq("full_name", body.repo_full_name)
    .maybeSingle();
  if (!repository) {
    return failure(
      correlationId,
      404,
      "repository_not_connected",
      "Repository is not available through the GitHub App",
    );
  }
  const { data: installation } = await admin
    .from("github_app_installations")
    .select("linked_user_id, suspended_at")
    .eq("id", repository.installation_id)
    .maybeSingle();
  if (installation?.linked_user_id !== user.id || installation.suspended_at) {
    return failure(
      correlationId,
      403,
      "repository_forbidden",
      "The GitHub App installation does not grant access to this repository",
    );
  }

  const clone = buildCloneCommand(repository.owner, repository.name);
  const { data: existing } = await admin
    .from("remote_repositories")
    .select("id, remote_path, display_name")
    .eq("instance_id", instance.id)
    .eq("remote_path", clone.path)
    .maybeSingle();
  if (existing) {
    return response(correlationId, 200, {
      status: "ready",
      repository: existing,
    });
  }

  let githubToken = "";
  try {
    githubToken = await getInstallationToken(repository.installation_id);
    const provider = new SpritesProvider(spritesConfigFromEnv());
    await provider.execOnMachine(
      instance.provider_resource_id,
      clone.argv,
      120,
      { GITHUB_TOKEN: githubToken },
    );

    const inspected = await provider.execOnMachine(
      instance.provider_resource_id,
      ["treq", "repo", "inspect", clone.path],
      30,
    );
    const inspection = JSON.parse(inspected.stdout) as {
      root?: unknown;
      descriptor?: { id?: unknown };
    };
    if (inspection.root !== clone.path) {
      throw new Error(
        "Typed repository inspection returned an unexpected root",
      );
    }

    const { data: registration, error: registrationError } = await admin
      .from("remote_repositories")
      .insert({
        owner_user_id: user.id,
        instance_id: instance.id,
        endpoint_id: null,
        remote_path: clone.path,
        display_name: repository.full_name,
      })
      .select("id, remote_path, display_name")
      .single();
    if (registrationError) throw new Error("Repository registration failed");

    return response(correlationId, 201, {
      status: "ready",
      repository: registration,
      inspection,
    });
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const safe = redactCloneFailure(raw, githubToken);
    const code =
      error instanceof ProviderError
        ? `sprite_${error.kind}`
        : "repository_clone_failed";
    console.error(
      JSON.stringify({
        operation: "managed_repository_clone_failed",
        correlation_id: correlationId,
        code,
      }),
    );
    return failure(correlationId, 502, code, safe);
  } finally {
    githubToken = "";
  }
});
