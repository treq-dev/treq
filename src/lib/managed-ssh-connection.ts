// Managed-VM certificate-authenticated SSH connection state machine
// (prds/remote-development.md, "SSH identity and certificates" > "Managed VM
// certificate flow"). This is the single cohesive service the managed setup
// UI drives: it takes a selected local SSH identity, registers its public
// key, provisions or reuses the one managed instance, polls readiness,
// requests the initial certificate, and activates a managed `SshEndpoint`
// with certificate authentication - then hands back a renewal controller so
// the caller can keep credentials fresh for future connections without
// interrupting current channels.
//
// This module never sees a private key: `readPublicKey` only ever resolves
// the public half (see `core::remote_local_keys::read_local_public_key` on
// the Rust side), and Treq never generates one (PRD Goal 9).

import type {
  ClientKeyResponse,
  InstanceStatusResponse,
  IssueCertificateResponse,
  ManagedInstanceState,
  RegionCode,
  SizePreset,
  SshEndpoint,
} from "./api-types-remote";
import type { CertificateLease } from "./remote-cert-lifecycle";

/** Lifecycle states a managed instance passes through before it is connectable (PRD "State machine"). */
const READY_STATE: ManagedInstanceState = "ready";
const TERMINAL_FAILURE_STATES: ReadonlySet<ManagedInstanceState> = new Set([
  "failed",
  "deleted",
]);

export interface RenewalController {
  stop: () => void;
}

export interface ManagedConnectionDeps {
  /** Resolves the OpenSSH public-key text for a local identity reference. Never returns private key material. */
  readPublicKey: (keyReference: string) => Promise<string>;
  /** Registers (or, on replay, returns) the public key with a stable idempotency key. */
  registerClientKey: (
    publicKey: string,
    comment: string | null,
    idempotencyKey: string,
  ) => Promise<ClientKeyResponse>;
  ensureInstance: (
    region: RegionCode,
    size: SizePreset,
    idempotencyKey: string,
  ) => Promise<unknown>;
  getInstanceStatus: () => Promise<InstanceStatusResponse>;
  issueCertificate: (
    instanceId: string,
    keyId: string,
  ) => Promise<IssueCertificateResponse>;
  /** Activates the returned managed `SshEndpoint` as the connection's active endpoint. */
  activateEndpoint: (endpoint: SshEndpoint) => void;
  /** Starts silent renewal for the issued certificate; swappable for tests. */
  startRenewal: (
    lease: CertificateLease,
    onRenewed?: (lease: CertificateLease) => void,
  ) => RenewalController;
  /** Clears a previously forced hard cutoff after reauthentication succeeds. */
  clearCutoff: (endpointId: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface ManagedConnectionResult {
  endpoint: SshEndpoint;
  key: ClientKeyResponse;
  renewal: RenewalController;
}

/** Stable (non-time-based) idempotency key: registering the same local identity twice must not register two keys. */
function keyRegistrationIdempotencyKey(keyReference: string): string {
  return `register-client-key:${keyReference}`;
}

/** Stable idempotency key for provisioning: repeating the same request must not create a second instance (PRD "Idempotency"). */
function provisionIdempotencyKey(
  keyReference: string,
  region: RegionCode,
  size: SizePreset,
): string {
  return `provision:${keyReference}:${region}:${size}`;
}

async function registerSelectedKey(
  deps: ManagedConnectionDeps,
  keyReference: string,
): Promise<ClientKeyResponse> {
  const publicKey = await deps.readPublicKey(keyReference);
  return deps.registerClientKey(
    publicKey,
    "treq-managed-vm",
    keyRegistrationIdempotencyKey(keyReference),
  );
}

const READINESS_POLL_INTERVAL_MS = 2_000;
const READINESS_POLL_TIMEOUT_MS = 10 * 60_000;

/** Polls structured lifecycle/readiness state until the instance is connectable (`ready`), or fails fast on a terminal failure state or timeout. */
export async function waitForInstanceReady(
  deps: ManagedConnectionDeps,
  options: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<InstanceStatusResponse> {
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const intervalMs = options.intervalMs ?? READINESS_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? READINESS_POLL_TIMEOUT_MS;
  const deadline = now() + timeoutMs;

  for (;;) {
    // Sequential polling is the point here - each iteration depends on the
    // previous one's result (has the instance become ready yet?), so this
    // cannot be parallelized.
    // eslint-disable-next-line no-await-in-loop
    const status = await deps.getInstanceStatus();
    const state = status.instance?.status;
    if (state === READY_STATE) return status;
    if (state && TERMINAL_FAILURE_STATES.has(state)) {
      throw new Error(
        `Managed instance provisioning failed (status: ${state}).`,
      );
    }
    if (now() >= deadline) {
      throw new Error(
        `Timed out waiting for the managed instance to become ready (last status: ${state ?? "unknown"}).`,
      );
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(intervalMs);
  }
}

async function issueAndActivate(
  deps: ManagedConnectionDeps,
  instanceId: string,
  key: ClientKeyResponse,
): Promise<{ endpoint: SshEndpoint; renewal: RenewalController }> {
  const response = await deps.issueCertificate(instanceId, key.id);
  const { endpoint } = response;
  deps.activateEndpoint(endpoint);

  const now = deps.now ?? Date.now;
  const issuedAt = now();
  const expiresAt = Date.parse(response.expires_at);
  const renewal = deps.startRenewal({
    instanceId,
    keyId: key.id,
    endpointId: endpoint.id,
    serial: response.serial,
    issuedAt,
    expiresAt,
  });

  return { endpoint, renewal };
}

export interface ConnectManagedInstanceOptions {
  region: RegionCode;
  size: SizePreset;
  keyReference: string;
}

/**
 * Full identity -> registration -> certificate -> endpoint sequence (PRD
 * "Managed VM certificate flow"): resolves the selected local identity's
 * public key, registers it, provisions or reuses the one managed instance,
 * polls readiness, requests the initial certificate, activates the endpoint,
 * and starts silent renewal.
 */
export async function connectManagedInstance(
  deps: ManagedConnectionDeps,
  options: ConnectManagedInstanceOptions,
): Promise<ManagedConnectionResult> {
  const key = await registerSelectedKey(deps, options.keyReference);

  await deps.ensureInstance(
    options.region,
    options.size,
    provisionIdempotencyKey(options.keyReference, options.region, options.size),
  );

  const status = await waitForInstanceReady(deps);
  const instanceId = status.instance?.instance_id;
  if (!instanceId) {
    throw new Error("Managed instance became ready without an instance id.");
  }

  const { endpoint, renewal } = await issueAndActivate(deps, instanceId, key);
  return { endpoint, key, renewal };
}

export interface ConnectExistingReadyInstanceOptions {
  status: InstanceStatusResponse;
  keyReference: string;
}

/**
 * Connect action for an existing ready managed instance: skips provisioning
 * and readiness polling (the caller already has a fresh `ready` status) but
 * still runs key registration, certificate issuance, endpoint activation,
 * and renewal - so "Connect" is not a shortcut around certificate auth.
 */
export async function connectExistingReadyInstance(
  deps: ManagedConnectionDeps,
  options: ConnectExistingReadyInstanceOptions,
): Promise<ManagedConnectionResult> {
  const { instance } = options.status;
  if (!instance || instance.status !== READY_STATE) {
    throw new Error(
      `Managed instance is not ready (status: ${instance?.status ?? "unprovisioned"}).`,
    );
  }
  const key = await registerSelectedKey(deps, options.keyReference);
  const { endpoint, renewal } = await issueAndActivate(
    deps,
    instance.instance_id,
    key,
  );
  return { endpoint, key, renewal };
}

export interface ReauthenticateManagedInstanceOptions {
  instanceId: string;
  endpointId: string;
  keyReference: string;
}

/**
 * Reauthentication after a hard cutoff (PRD "The user regains access only by
 * reauthenticating and obtaining a new certificate"). Cutoff is cleared only
 * after certificate issuance actually succeeds - a failed reauthentication
 * attempt must leave the endpoint blocked, not silently restore access.
 */
export async function reauthenticateManagedInstance(
  deps: ManagedConnectionDeps,
  options: ReauthenticateManagedInstanceOptions,
): Promise<ManagedConnectionResult> {
  const key = await registerSelectedKey(deps, options.keyReference);
  const { endpoint, renewal } = await issueAndActivate(
    deps,
    options.instanceId,
    key,
  );
  await deps.clearCutoff(options.endpointId);
  return { endpoint, key, renewal };
}
