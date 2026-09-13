// Edge function: managed compute instance lifecycle for Remote SSH Control
// (prds/remote-ssh.md, Phase 2: Sprites provisioning).
//
// POST body: { action, idempotency_key?, region?, size_preset? }
// action:
//   "ensure"       - provision lazily, idempotent (Goal 1 / "Provisioning trigger")
//   "status"       - read current instance + endpoint status
//   "wake"         - request a suspended instance resume
//   "reprovision"  - replace the instance (new size/region/manifest), increments generation
//   "delete"       - tear down the instance
//   "list_regions" - closed set of region codes
//   "list_sizes"   - closed set of size presets
//
// Auth: user JWT in Authorization header. Every mutating action verifies the
// Supabase principal and that the instance (if referenced) belongs to them —
// per the PRD's "Edge Functions verify both the Supabase principal and
// resource ownership instead of relying only on client-supplied IDs."
//
// Provider credentials (Fly Sprites token) are read from Edge Function
// secrets and never returned to the client.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  BASE_ALLOCATION,
  isBaseAllocationPreset,
  isRegionCode,
  isSizePreset,
  REGION_CODES,
  SIZE_PRESETS,
  type RegionCode,
  type SizePreset,
} from "../_shared/remote/catalog.ts";
import { CURRENT_MANIFEST_VERSION } from "../_shared/remote/boot-manifest.ts";
import {
  ProviderError,
  SpritesProvider,
  spritesConfigFromEnv,
  type ManagedComputeProvider,
} from "../_shared/remote/sprites-adapter.ts";
import { isSpritesStubEnabled, StubSpritesProvider } from "../_shared/remote/stub-sprites-adapter.ts";
import { recordAuditEvent, startTimer } from "../_shared/remote/audit.ts";
import { correlationIdFromRequest, logWithCorrelation } from "../_shared/remote/correlation.ts";
import {
  beginOperation,
  completeOperation,
  createProvisioningInstance,
  findExistingOperation,
  getInstanceForOwner,
  previousHostKeyFingerprint,
  recordEndpointHostKey,
  recordManagedEndpoint,
  updateInstance,
  type InstanceRow,
} from "../_shared/remote/instance-store.ts";
import { KeyscanError, scanHostKey } from "../_shared/remote/ssh-keyscan.ts";
import { caKeyMaterialFromEnv, caPublicKeyLine } from "../_shared/remote/ssh-cert.ts";
import { installCaTrustCommand } from "../_shared/remote/ssh-vm-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MANAGED_SSH_PORT = 22;
const MANAGED_SSH_USERNAME = "treq";

function json(body: unknown, status = 200, correlationId?: string): Response {
  return new Response(JSON.stringify(correlationId ? { ...(body as object), correlation_id: correlationId } : body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      ...(correlationId ? { "x-correlation-id": correlationId } : {}),
    },
  });
}

// Clients (desktop's ManagedInstanceRecord in remote_provider.rs, mobile's
// ManagedInstanceRecord in api-types-remote.ts) deserialize this instance
// under an `instance_id` field, but the DB row's primary key column is
// `id` - serialize it under the wire contract's name rather than the raw
// row, or every instance-bearing response silently fails to round-trip
// `instance_id` on both clients.
function serializeInstance(row: InstanceRow | null): (Omit<InstanceRow, "id"> & { instance_id: string }) | null {
  if (!row) return null;
  const { id, ...rest } = row;
  return { instance_id: id, ...rest };
}

function getProvider(): ManagedComputeProvider {
  if (isSpritesStubEnabled()) return new StubSpritesProvider();
  return new SpritesProvider(spritesConfigFromEnv());
}

function providerErrorStatus(err: ProviderError): number {
  switch (err.kind) {
    case "not_found":
      return 404;
    case "already_exists":
      return 409;
    case "quota_exceeded":
      return 429;
    case "invalid_request":
      return 400;
    case "timeout":
      return 504;
    case "unavailable":
      return 502;
    default:
      return 500;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders, status: 204 });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("authorization") ?? "";
  const userToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!userToken) return json({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${userToken}` } },
  });
  const {
    data: { user },
    error: authError,
  } = await supabaseUser.auth.getUser();
  if (authError || !user) return json({ error: "Unauthorized" }, 401);

  // deno-lint-ignore no-explicit-any
  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const action = body.action;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const correlationId = correlationIdFromRequest(req);

  try {
    switch (action) {
      case "list_regions":
        return json({ regions: REGION_CODES }, 200, correlationId);
      case "list_sizes":
        return json({ presets: SIZE_PRESETS }, 200, correlationId);
      case "status":
        return await handleStatus(supabase, user.id, correlationId);
      case "ensure":
        return await handleEnsure(supabase, user.id, body, correlationId);
      case "wake":
        return await handleWake(supabase, user.id, body, correlationId);
      case "reprovision":
        return await handleReprovision(supabase, user.id, body, correlationId);
      case "delete":
        return await handleDelete(supabase, user.id, body, correlationId);
      default:
        return json({ error: `Unknown action '${action}'` }, 400, correlationId);
    }
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      return json({ error: err.message, code: err.code, base_allocation: BASE_ALLOCATION }, 422, correlationId);
    }
    if (err instanceof ProviderError) {
      return json({ error: err.message, provider_error: err.kind }, providerErrorStatus(err), correlationId);
    }
    if (err instanceof ValidationErrorWithStatus) {
      return json({ error: err.message }, err.status, correlationId);
    }
    logWithCorrelation(correlationId, "error", `remote-instance action=${action} failed: ${(err as Error).message}`);
    return json({ error: "Internal error" }, 500, correlationId);
  }
});

async function handleStatus(supabase: SupabaseClient, ownerUserId: string, correlationId: string): Promise<Response> {
  const instance = await getInstanceForOwner(supabase, ownerUserId);
  if (!instance) return json({ instance: null, endpoint: null }, 200, correlationId);

  let endpoint = null;
  if (instance.endpoint_id) {
    const { data } = await supabase
      .from("remote_endpoints")
      .select("id, hostname, port, username, source")
      .eq("id", instance.endpoint_id)
      .maybeSingle();
    endpoint = data ?? null;
  }
  return json({ instance: serializeInstance(instance), endpoint }, 200, correlationId);
}

// Closes the Phase 2 "host key fingerprint not yet available" gap with a
// real scan, and installs CA trust on the freshly (re)provisioned VM (PRD
// "Configure the managed VM to trust the Treq SSH CA"). Both steps are best
// effort at this point in provisioning: a fresh machine's sshd may not be
// reachable for a few seconds after the provider reports it started, so a
// failure here is recorded as an auditable readiness-stage failure rather
// than failing the whole provision/reprovision operation - the caller (or a
// later explicit `keyscan_endpoint` / retry) can complete it once the VM is
// actually reachable.
async function establishSshTrust(
  supabase: SupabaseClient,
  provider: ManagedComputeProvider,
  params: {
    ownerUserId: string;
    instanceId: string;
    endpointId: string;
    providerResourceId: string;
    hostname: string;
    port: number;
    generation: number;
    correlationId: string;
  },
): Promise<void> {
  if (isSpritesStubEnabled()) {
    // The stub adapter's address (`stub-xxx.stub.internal`) is not a real
    // reachable host: there is nothing to scan or exec against in local/
    // service-qa mode. Record a clearly-labeled stub fingerprint so
    // downstream code paths that expect a host key row still have one.
    await recordEndpointHostKey(supabase, {
      ownerUserId: params.ownerUserId,
      endpointId: params.endpointId,
      algorithm: "ssh-ed25519",
      fingerprintSha256: "SHA256:stub-mode-no-real-host-key",
      generation: params.generation,
    });
    await recordAuditEvent(supabase, {
      ownerUserId: params.ownerUserId,
      instanceId: params.instanceId,
      endpointId: params.endpointId,
      eventType: "host_key_registered",
      detail: { note: "REMOTE_SPRITES_STUB active: recorded a placeholder fingerprint, not a real scan", generation: params.generation },
      correlationId: params.correlationId,
    });
    return;
  }

  try {
    const scanned = await scanHostKey(params.hostname, params.port);
    await recordEndpointHostKey(supabase, {
      ownerUserId: params.ownerUserId,
      endpointId: params.endpointId,
      algorithm: scanned.algorithm,
      fingerprintSha256: scanned.fingerprintSha256,
      generation: params.generation,
    });
    await recordAuditEvent(supabase, {
      ownerUserId: params.ownerUserId,
      instanceId: params.instanceId,
      endpointId: params.endpointId,
      eventType: "host_key_registered",
      detail: { algorithm: scanned.algorithm, fingerprint: scanned.fingerprintSha256, generation: params.generation },
      correlationId: params.correlationId,
    });
  } catch (err) {
    const kind = err instanceof KeyscanError ? err.kind : "other";
    await recordAuditEvent(supabase, {
      ownerUserId: params.ownerUserId,
      instanceId: params.instanceId,
      endpointId: params.endpointId,
      eventType: "readiness_stage_failed",
      detail: { stage: "host_keyscan", reason: (err as Error).message, kind },
      correlationId: params.correlationId,
    });
  }

  try {
    const ca = caKeyMaterialFromEnv();
    const result = await provider.execOnMachine(params.providerResourceId, installCaTrustCommand(caPublicKeyLine(ca)));
    if (result.exitCode !== 0) throw new Error(`ca trust install exited ${result.exitCode}: ${result.stderr || result.stdout}`);
    await recordAuditEvent(supabase, {
      ownerUserId: params.ownerUserId,
      instanceId: params.instanceId,
      endpointId: params.endpointId,
      eventType: "ca_trust_installed",
      detail: { generation: params.generation },
      correlationId: params.correlationId,
    });
  } catch (err) {
    await recordAuditEvent(supabase, {
      ownerUserId: params.ownerUserId,
      instanceId: params.instanceId,
      endpointId: params.endpointId,
      eventType: "ca_trust_install_failed",
      detail: { error: (err as Error).message },
      correlationId: params.correlationId,
    });
  }
}

function requireIdempotencyKey(body: Record<string, unknown>): string {
  const key = body.idempotency_key;
  if (typeof key !== "string" || key.length === 0) {
    throw new ValidationError("idempotency_key is required");
  }
  return key;
}

class ValidationError extends Error {}

async function handleEnsure(
  supabase: SupabaseClient,
  ownerUserId: string,
  // deno-lint-ignore no-explicit-any
  body: Record<string, any>,
  correlationId: string,
): Promise<Response> {
  const elapsed = startTimer();
  let idempotencyKey: string;
  try {
    idempotencyKey = requireIdempotencyKey(body);
  } catch (err) {
    return json({ error: (err as Error).message }, 400, correlationId);
  }

  const region: RegionCode = isRegionCode(body.region) ? body.region : "us_east";
  const sizePreset: SizePreset = isSizePreset(body.size_preset) ? body.size_preset : "small";
  assertWithinBaseAllocation(sizePreset);

  const existingOp = await findExistingOperation(supabase, ownerUserId, idempotencyKey);
  if (existingOp) {
    // Repeated request with the same key: never create a second instance.
    const instance = await getInstanceForOwner(supabase, ownerUserId);
    return json({ operation_id: existingOp.id, status: existingOp.status, instance: serializeInstance(instance) }, 200, correlationId);
  }

  const existingInstance = await getInstanceForOwner(supabase, ownerUserId);
  if (existingInstance && existingInstance.status !== "deleted") {
    // One managed instance per user (Goal 1): ensure is a no-op once
    // provisioned, regardless of idempotency key, so a second "first open of
    // a managed repo" never provisions a second VM.
    const op = await beginOperation(supabase, {
      ownerUserId,
      instanceId: existingInstance.id,
      operationType: "provision",
      idempotencyKey,
    });
    await completeOperation(supabase, op.id, { status: "succeeded" });
    return json({ operation_id: op.id, status: "succeeded", instance: serializeInstance(existingInstance) }, 200, correlationId);
  }

  const instance = await createProvisioningInstance(supabase, {
    ownerUserId,
    region,
    sizePreset,
    manifestVersion: CURRENT_MANIFEST_VERSION,
  });

  const op = await beginOperation(supabase, {
    ownerUserId,
    instanceId: instance.id,
    operationType: "provision",
    idempotencyKey,
  });

  await recordAuditEvent(supabase, {
    ownerUserId,
    instanceId: instance.id,
    eventType: "instance_create_requested",
    detail: { region, size_preset: sizePreset, manifest_version: CURRENT_MANIFEST_VERSION },
    correlationId,
    idempotencyKey,
  });

  try {
    const provider = getProvider();
    const providerInstance = await provider.createInstance({
      ownerUserId,
      region,
      sizePreset,
      manifestVersion: CURRENT_MANIFEST_VERSION,
      idempotencyKey,
    });

    const status = mapProviderStateToInstanceStatus(providerInstance.state);
    await updateInstance(supabase, instance.id, {
      provider_resource_id: providerInstance.providerResourceId,
      status,
      ready_at: status === "ready" ? new Date().toISOString() : null,
    });

    if (providerInstance.address) {
      const endpointId = await recordManagedEndpoint(supabase, {
        ownerUserId,
        instanceId: instance.id,
        hostname: providerInstance.address,
        port: MANAGED_SSH_PORT,
        username: MANAGED_SSH_USERNAME,
        existingEndpointId: null,
      });
      await updateInstance(supabase, instance.id, { endpoint_id: endpointId });
      await establishSshTrust(supabase, provider, {
        ownerUserId,
        instanceId: instance.id,
        endpointId,
        providerResourceId: providerInstance.providerResourceId,
        hostname: providerInstance.address,
        port: MANAGED_SSH_PORT,
        generation: 0,
        correlationId,
      });
    } else {
      await recordAuditEvent(supabase, {
        ownerUserId,
        instanceId: instance.id,
        eventType: "readiness_stage_failed",
        detail: { stage: "endpoint_address", reason: "provider did not return an address yet" },
        correlationId,
      });
    }

    await completeOperation(supabase, op.id, {
      status: "succeeded",
      providerRequestId: providerInstance.providerResourceId,
    });
    await recordAuditEvent(supabase, {
      ownerUserId,
      instanceId: instance.id,
      eventType: "instance_create_succeeded",
      detail: { provider_resource_id: providerInstance.providerResourceId, observed_state: providerInstance.state },
      correlationId,
      providerRequestId: providerInstance.providerResourceId,
      durationMs: elapsed(),
    });

    const refreshed = await getInstanceForOwner(supabase, ownerUserId);
    return json({ operation_id: op.id, status: "succeeded", instance: serializeInstance(refreshed) }, 200, correlationId);
  } catch (err) {
    await updateInstance(supabase, instance.id, { status: "failed" });
    await completeOperation(supabase, op.id, { status: "failed", errorMessage: (err as Error).message });
    await recordAuditEvent(supabase, {
      ownerUserId,
      instanceId: instance.id,
      eventType: "instance_create_failed",
      detail: { error: (err as Error).message },
      correlationId,
      durationMs: elapsed(),
    });
    throw err;
  }
}

async function handleWake(
  supabase: SupabaseClient,
  ownerUserId: string,
  // deno-lint-ignore no-explicit-any
  body: Record<string, any>,
  correlationId: string,
): Promise<Response> {
  const elapsed = startTimer();
  let idempotencyKey: string;
  try {
    idempotencyKey = requireIdempotencyKey(body);
  } catch (err) {
    return json({ error: (err as Error).message }, 400, correlationId);
  }

  const instance = await requireOwnedInstance(supabase, ownerUserId, body.instance_id);
  if (!instance.provider_resource_id) return json({ error: "Instance has no provider resource yet" }, 409, correlationId);

  const existingOp = await findExistingOperation(supabase, ownerUserId, idempotencyKey);
  if (existingOp) return json({ operation_id: existingOp.id, status: existingOp.status }, 200, correlationId);

  const op = await beginOperation(supabase, { ownerUserId, instanceId: instance.id, operationType: "wake", idempotencyKey });
  await recordAuditEvent(supabase, { ownerUserId, instanceId: instance.id, eventType: "instance_wake_requested", correlationId, idempotencyKey });

  try {
    await updateInstance(supabase, instance.id, { status: "waking" });
    const provider = getProvider();
    await provider.wakeInstance(instance.provider_resource_id);
    const providerInstance = await provider.getInstance(instance.provider_resource_id);
    const status = mapProviderStateToInstanceStatus(providerInstance.state);
    await updateInstance(supabase, instance.id, {
      status,
      ready_at: status === "ready" ? new Date().toISOString() : instance.ready_at,
    });
    await completeOperation(supabase, op.id, { status: "succeeded" });
    await recordAuditEvent(supabase, {
      ownerUserId,
      instanceId: instance.id,
      eventType: "instance_wake_succeeded",
      detail: { observed_state: providerInstance.state },
      correlationId,
      durationMs: elapsed(),
    });
    return json({ operation_id: op.id, status: "succeeded" }, 200, correlationId);
  } catch (err) {
    await completeOperation(supabase, op.id, { status: "failed", errorMessage: (err as Error).message });
    await recordAuditEvent(supabase, {
      ownerUserId,
      instanceId: instance.id,
      eventType: "instance_wake_failed",
      detail: { error: (err as Error).message },
      correlationId,
      durationMs: elapsed(),
    });
    throw err;
  }
}

async function handleReprovision(
  supabase: SupabaseClient,
  ownerUserId: string,
  // deno-lint-ignore no-explicit-any
  body: Record<string, any>,
  correlationId: string,
): Promise<Response> {
  const elapsed = startTimer();
  let idempotencyKey: string;
  try {
    idempotencyKey = requireIdempotencyKey(body);
  } catch (err) {
    return json({ error: (err as Error).message }, 400, correlationId);
  }

  const instance = await requireOwnedInstance(supabase, ownerUserId, body.instance_id);
  if (!instance.provider_resource_id) return json({ error: "Instance has no provider resource yet" }, 409, correlationId);

  const region: RegionCode = isRegionCode(body.region) ? body.region : instance.region;
  const sizePreset: SizePreset = isSizePreset(body.size_preset) ? body.size_preset : instance.size_preset;
  assertWithinBaseAllocation(sizePreset);
  // Region migration is not supported (PRD non-goal): a region change is a
  // brand-new resource at the vendor, not an in-place update, so surface it
  // as a validation error here rather than silently reprovisioning in place.
  if (region !== instance.region) {
    return json(
      { error: "Region migration is not supported. Delete and re-provision in the new region instead." },
      400,
      correlationId,
    );
  }

  const existingOp = await findExistingOperation(supabase, ownerUserId, idempotencyKey);
  if (existingOp) return json({ operation_id: existingOp.id, status: existingOp.status }, 200, correlationId);

  const op = await beginOperation(supabase, {
    ownerUserId,
    instanceId: instance.id,
    operationType: "reprovision",
    idempotencyKey,
  });
  const nextGeneration = instance.generation + 1;
  await recordAuditEvent(supabase, {
    ownerUserId,
    instanceId: instance.id,
    eventType: "instance_replace_requested",
    detail: { region, size_preset: sizePreset, from_generation: instance.generation, to_generation: nextGeneration },
    correlationId,
    idempotencyKey,
  });

  try {
    await updateInstance(supabase, instance.id, { status: "reprovisioning" });
    const provider = getProvider();
    const providerInstance = await provider.replaceInstance({
      providerResourceId: instance.provider_resource_id,
      region,
      sizePreset,
      manifestVersion: CURRENT_MANIFEST_VERSION,
      idempotencyKey,
    });

    const status = mapProviderStateToInstanceStatus(providerInstance.state);
    // The control plane increments the instance generation on every replace
    // (PRD "Reprovisioning"), regardless of whether the address changed —
    // clients treat this as an explicit trust transition.
    await updateInstance(supabase, instance.id, {
      status,
      generation: nextGeneration,
      size_preset: sizePreset,
      image_manifest_version: CURRENT_MANIFEST_VERSION,
      ready_at: status === "ready" ? new Date().toISOString() : null,
    });

    if (providerInstance.address) {
      const endpointId = await recordManagedEndpoint(supabase, {
        ownerUserId,
        instanceId: instance.id,
        hostname: providerInstance.address,
        port: MANAGED_SSH_PORT,
        username: MANAGED_SSH_USERNAME,
        existingEndpointId: instance.endpoint_id,
      });
      if (!instance.endpoint_id) await updateInstance(supabase, instance.id, { endpoint_id: endpointId });

      const previousFingerprint = instance.endpoint_id
        ? await previousHostKeyFingerprint(supabase, instance.endpoint_id)
        : null;

      // Real keyscan against the (possibly replaced) VM, recorded at the new
      // generation, plus CA trust re-install (a replacement VM starts from
      // the base image and does not inherit the previous machine's sshd
      // config). This is the explicit host-key rotation record the PRD's
      // "Reprovisioning may rotate the host key" paragraph calls for: old
      // fingerprint, new fingerprint, generation, timestamp, and provider
      // resource id are all captured here (initiating principal is
      // `ownerUserId`, the only principal that can call reprovision).
      await establishSshTrust(supabase, provider, {
        ownerUserId,
        instanceId: instance.id,
        endpointId,
        providerResourceId: providerInstance.providerResourceId,
        hostname: providerInstance.address,
        port: MANAGED_SSH_PORT,
        generation: nextGeneration,
        correlationId,
      });
      await recordAuditEvent(supabase, {
        ownerUserId,
        instanceId: instance.id,
        endpointId,
        eventType: "host_key_rotated",
        detail: {
          previous_fingerprint: previousFingerprint,
          generation: nextGeneration,
          provider_resource_id: providerInstance.providerResourceId,
          initiating_principal: ownerUserId,
        },
        correlationId,
      });
    }

    await completeOperation(supabase, op.id, { status: "succeeded", providerRequestId: providerInstance.providerResourceId });
    await recordAuditEvent(supabase, {
      ownerUserId,
      instanceId: instance.id,
      eventType: "instance_replace_succeeded",
      detail: { generation: nextGeneration, observed_state: providerInstance.state },
      correlationId,
      providerRequestId: providerInstance.providerResourceId,
      durationMs: elapsed(),
    });

    const refreshed = await getInstanceForOwner(supabase, ownerUserId);
    return json({ operation_id: op.id, status: "succeeded", instance: serializeInstance(refreshed) }, 200, correlationId);
  } catch (err) {
    await completeOperation(supabase, op.id, { status: "failed", errorMessage: (err as Error).message });
    await recordAuditEvent(supabase, {
      ownerUserId,
      instanceId: instance.id,
      eventType: "instance_replace_failed",
      detail: { error: (err as Error).message },
      correlationId,
      durationMs: elapsed(),
    });
    throw err;
  }
}

async function handleDelete(
  supabase: SupabaseClient,
  ownerUserId: string,
  // deno-lint-ignore no-explicit-any
  body: Record<string, any>,
  correlationId: string,
): Promise<Response> {
  const elapsed = startTimer();
  let idempotencyKey: string;
  try {
    idempotencyKey = requireIdempotencyKey(body);
  } catch (err) {
    return json({ error: (err as Error).message }, 400, correlationId);
  }

  const instance = await requireOwnedInstance(supabase, ownerUserId, body.instance_id);

  const existingOp = await findExistingOperation(supabase, ownerUserId, idempotencyKey);
  if (existingOp) return json({ operation_id: existingOp.id, status: existingOp.status }, 200, correlationId);

  const op = await beginOperation(supabase, { ownerUserId, instanceId: instance.id, operationType: "delete", idempotencyKey });
  await recordAuditEvent(supabase, { ownerUserId, instanceId: instance.id, eventType: "instance_delete_requested", correlationId, idempotencyKey });

  try {
    await updateInstance(supabase, instance.id, { status: "deleting" });
    if (instance.provider_resource_id) {
      const provider = getProvider();
      await provider.deleteInstance(instance.provider_resource_id);
    }
    await updateInstance(supabase, instance.id, { status: "deleted", endpoint_id: null });
    await completeOperation(supabase, op.id, { status: "succeeded" });
    await recordAuditEvent(supabase, {
      ownerUserId,
      instanceId: instance.id,
      eventType: "instance_delete_succeeded",
      correlationId,
      durationMs: elapsed(),
    });
    return json({ operation_id: op.id, status: "succeeded" }, 200, correlationId);
  } catch (err) {
    await completeOperation(supabase, op.id, { status: "failed", errorMessage: (err as Error).message });
    await recordAuditEvent(supabase, {
      ownerUserId,
      instanceId: instance.id,
      eventType: "instance_delete_failed",
      detail: { error: (err as Error).message },
      correlationId,
      durationMs: elapsed(),
    });
    throw err;
  }
}

// Resolves the instance to act on and verifies ownership server-side, per
// the PRD's security requirement to check both principal and resource
// ownership rather than trusting a client-supplied instance id alone. A
// caller may omit instance_id (there is only ever one managed instance per
// user); if they supply one, it must match the caller's own instance.
async function requireOwnedInstance(
  supabase: SupabaseClient,
  ownerUserId: string,
  suppliedInstanceId: unknown,
): Promise<InstanceRow> {
  const instance = await getInstanceForOwner(supabase, ownerUserId);
  if (!instance) throw new ValidationErrorWithStatus("No managed instance for this user", 404);
  if (typeof suppliedInstanceId === "string" && suppliedInstanceId !== instance.id) {
    throw new ValidationErrorWithStatus("Instance does not belong to this user", 403);
  }
  return instance;
}

class ValidationErrorWithStatus extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

// PRD "Resource quotas": "purchasing additional disk or compute as a plan
// add-on is explicitly deferred ... and must not be implemented yet, only
// the enforcement of the base limits." A `size_preset` above the base
// allocation must fail as a distinct, structured error - never silently
// downgraded to the base allocation and never surfaced as a generic
// provider/validation failure - so the UI can explain that add-ons aren't
// available yet rather than guessing why provisioning was rejected.
class QuotaExceededError extends Error {
  readonly code = "size_preset_exceeds_base_allocation";
  constructor(public readonly requestedPreset: SizePreset) {
    super(
      `size_preset '${requestedPreset}' exceeds the base allocation (${BASE_ALLOCATION.vcpu} vCPU / ${BASE_ALLOCATION.ramGb} GB RAM / ${BASE_ALLOCATION.diskGb} GB disk). Purchasing additional resources is not yet available.`,
    );
  }
}

// Enforced both at initial provisioning and at reprovisioning ("These
// limits are enforced now, at provisioning and on an ongoing basis").
function assertWithinBaseAllocation(sizePreset: SizePreset): void {
  if (!isBaseAllocationPreset(sizePreset)) {
    throw new QuotaExceededError(sizePreset);
  }
}

function mapProviderStateToInstanceStatus(state: string): string {
  // Provider states map 1:1 onto the domain lifecycle states already
  // enumerated in the remote_instances status check constraint.
  return state;
}
