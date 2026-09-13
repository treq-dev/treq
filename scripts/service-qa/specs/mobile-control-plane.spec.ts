/**
 * Worked example: the mobile app's control-plane contract
 * (`mobile/src/lib/controlPlane.ts`) against a real local Supabase CLI
 * stack instead of the mocked Supabase client Jest uses in
 * `mobile/src/screens/__tests__/*.test.tsx`.
 *
 * This does not import mobile's TypeScript directly (Jest/RN and this
 * Node/vitest harness use different module resolution and RN-only globals
 * would need polyfilling for no benefit) - it exercises the exact same
 * request/response shapes controlPlane.ts sends and expects, against the
 * same `remote-instance` / `remote-ssh-trust` edge functions, closing the
 * gap called out in mobile/README.md's "What's still not verified":
 * "The control-plane client ... against a live Supabase stack: still
 * mocked-client-only ... since bringing up the local Supabase CLI stack
 * needs a reachable Docker daemon."
 *
 * Requires `REMOTE_SPRITES_STUB=1` (set by `scripts/service-qa/up.sh`) so
 * `ensure`/`wake`/`status` resolve without a real Fly.io account.
 */
import { it, expect, afterEach } from "vitest";
import { getAnonClient, getAnonKey, getFunctionsBaseUrl, getServiceClient } from "../clients";
import { FEATURES } from "../features";
import { createTestUser, deleteTestUser, type TestUser } from "../seed";
import { recordOutcome } from "../record";

const usersToDelete: string[] = [];

afterEach(async () => {
  const admin = getServiceClient();
  while (usersToDelete.length > 0) {
    const id = usersToDelete.pop()!;
    try {
      await deleteTestUser(admin, id);
    } catch {
      // already deleted
    }
  }
});

async function signedInUser(): Promise<{
  testUser: TestUser;
  client: ReturnType<typeof getAnonClient>;
  accessToken: string;
}> {
  expect(FEATURES.emailSignup).toBe(true);
  const testUser = await createTestUser();
  usersToDelete.push(testUser.user.id);
  const client = getAnonClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: testUser.email,
    password: testUser.password,
  });
  if (error || !data.session) {
    throw new Error(`sign-in failed: ${error?.message ?? "no session"}`);
  }
  return { testUser, client, accessToken: data.session.access_token };
}

/** Mirrors mobile's `invokeRemoteInstance`/`invokeRemoteTrust` - a bare
 * fetch against `functions/v1/<name>` with `{ action, ...body }`, same as
 * `supabase.functions.invoke` sends over the wire. */
async function invoke(
  fnName: "remote-instance" | "remote-ssh-trust",
  accessToken: string,
  action: string,
  body: Record<string, unknown> = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`${getFunctionsBaseUrl()}/${fnName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      apikey: getAnonKey(),
    },
    body: JSON.stringify({ action, ...body }),
  });
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, json };
}

/** Minimal OpenSSH `ssh-ed25519 <base64> <comment>` line encoder, same
 * approach `supabase/functions/tests/remote_e2e.test.ts` uses, so this spec
 * doesn't need an SSH-key-format library either. */
async function generateOpenSshEd25519PublicKey(comment: string): Promise<string> {
  const keyPair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const rawPublic = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const typeBytes = new TextEncoder().encode("ssh-ed25519");
  const encodeUint32 = (value: number) => {
    const buf = new Uint8Array(4);
    new DataView(buf.buffer).setUint32(0, value, false);
    return buf;
  };
  const parts = [encodeUint32(typeBytes.length), typeBytes, encodeUint32(rawPublic.length), rawPublic];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const blob = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    blob.set(part, offset);
    offset += part.length;
  }
  let binary = "";
  for (const byte of blob) binary += String.fromCharCode(byte);
  return `ssh-ed25519 ${btoa(binary)} ${comment}`;
}

it("mobile listRegions/listSizePresets return the catalog controlPlane.ts expects", async () => {
  const { accessToken } = await signedInUser();

  const regions = await invoke("remote-instance", accessToken, "list_regions");
  expect(regions.status).toBe(200);
  expect(Array.isArray(regions.json.regions)).toBe(true);
  expect((regions.json.regions as unknown[]).length).toBeGreaterThan(0);

  const sizes = await invoke("remote-instance", accessToken, "list_sizes");
  expect(sizes.status).toBe(200);
  expect(Array.isArray(sizes.json.presets)).toBe(true);
  expect((sizes.json.presets as unknown[]).length).toBeGreaterThan(0);

  await recordOutcome("mobile-control-plane-01-catalog", {
    expectations: [
      "list_regions returns HTTP 200 with a non-empty regions array.",
      "list_sizes returns HTTP 200 with a non-empty presets array.",
    ],
    details: { regions: regions.json.regions, presets: sizes.json.presets },
  });
}, 60_000);

it(
  "mobile's registerClientKey -> ensureInstance -> issueCertificate round trip succeeds against the real edge functions",
  async () => {
    const { testUser, accessToken } = await signedInUser();

    // Mirrors ManagedConnectScreen.handleConnect: getInstanceStatus first
    // (no instance yet), then ensureInstance with a fresh idempotency key.
    const initialStatus = await invoke("remote-instance", accessToken, "status");
    expect(initialStatus.status).toBe(200);

    const ensure = await invoke("remote-instance", accessToken, "ensure", {
      idempotency_key: `mobile-qa-${crypto.randomUUID()}`,
      region: "us_east",
      size_preset: "small",
    });
    expect(ensure.status).toBe(200);
    const ensureInstance = ensure.json.instance as { instance_id?: string } | null;
    const instanceId = String(ensureInstance?.instance_id ?? "");
    expect(instanceId).not.toBe("");

    // Poll status until the stub adapter settles on a terminal state - the
    // stub resolves fast, but this mirrors ManagedConnectScreen's own
    // schedulePollIfTransient loop rather than assuming a single poll.
    const transientStates = [
      "provisioning",
      "bootstrapping",
      "installing_access",
      "verifying",
      "waking",
      "reprovisioning",
    ];
    const deadline = Date.now() + 30_000;
    let lastStatus = "";
    let statusJson: Record<string, unknown> = {};
    while (Date.now() < deadline) {
      const poll = await invoke("remote-instance", accessToken, "status");
      expect(poll.status).toBe(200);
      statusJson = poll.json;
      const instance = poll.json.instance as { status?: string } | null;
      lastStatus = String(instance?.status ?? "");
      if (!transientStates.includes(lastStatus)) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(lastStatus).toBe("ready");

    // registerClientKey: mobile's own generateDeviceKey() produces a real
    // ed25519 keypair via the native module; this spec's stand-in is the
    // same OpenSSH-line encoding remote_e2e.test.ts uses.
    const publicKey = await generateOpenSshEd25519PublicKey(`${testUser.email}@mobile-qa`);
    const register = await invoke("remote-ssh-trust", accessToken, "register_client_key", {
      idempotency_key: `mobile-qa-${crypto.randomUUID()}`,
      public_key: publicKey,
      comment: "React Native device",
    });
    expect(register.status).toBe(200);
    const registeredKey = (register.json.key ?? (register.json.keys as unknown[] | undefined)?.[0]) as
      | { id?: string }
      | undefined;
    expect(registeredKey?.id).toBeTruthy();
    const keyId = registeredKey!.id!;

    // issueCertificate: the exact request shape controlPlane.ts's
    // issueCertificate/ManagedConnectScreen.handleConnect send.
    const issue = await invoke("remote-ssh-trust", accessToken, "issue_certificate", {
      instance_id: instanceId,
      key_id: keyId,
    });
    expect(issue.status).toBe(200);
    expect(typeof issue.json.certificate).toBe("string");
    expect(issue.json.certificate).not.toBe("");
    const endpoint = issue.json.endpoint as { host_keys?: Array<{ fingerprint_sha256?: string }> } | undefined;
    expect(endpoint?.host_keys?.[0]?.fingerprint_sha256).toBeTruthy();

    // Silent renewal: certRenewal.ts's CertificateRenewalManager calls
    // issue_certificate again with `renewal: true` ahead of expiry.
    const renewed = await invoke("remote-ssh-trust", accessToken, "issue_certificate", {
      instance_id: instanceId,
      key_id: keyId,
      renewal: true,
    });
    expect(renewed.status).toBe(200);
    expect(renewed.json.serial).not.toBe(issue.json.serial);

    // wakeInstance: ManagedConnectScreen's handleWake path against an
    // already-ready (non-suspended) instance, same as the desktop e2e
    // suite's "ordinary wake" case.
    const wake = await invoke("remote-instance", accessToken, "wake", {
      instance_id: instanceId,
      idempotency_key: `mobile-qa-${crypto.randomUUID()}`,
    });
    expect(wake.status).toBe(200);

    await invoke("remote-instance", accessToken, "delete", {
      idempotency_key: `mobile-qa-${crypto.randomUUID()}`,
    });

    await recordOutcome("mobile-control-plane-02-full-round-trip", {
      expectations: [
        "ensureInstance provisions and the stub adapter reaches status=ready.",
        "registerClientKey + issueCertificate return a key id, a certificate, and a trusted host key, and a renewal call returns a distinct serial.",
        "wakeInstance against a ready instance returns HTTP 200.",
      ],
      details: {
        instanceId,
        keyId,
        initialStatus: initialStatus.json,
        readyStatus: statusJson,
        firstSerial: issue.json.serial,
        renewedSerial: renewed.json.serial,
      },
    });
  },
  60_000,
);

it("issueCertificate rejects an unregistered key id, matching controlPlane.ts's error-throwing contract", async () => {
  const { accessToken } = await signedInUser();

  const ensure = await invoke("remote-instance", accessToken, "ensure", {
    idempotency_key: `mobile-qa-${crypto.randomUUID()}`,
    region: "us_east",
    size_preset: "small",
  });
  expect(ensure.status).toBe(200);
  const ensureInstance = ensure.json.instance as { instance_id?: string } | null;
  const instanceId = String(ensureInstance?.instance_id ?? "");

  const issue = await invoke("remote-ssh-trust", accessToken, "issue_certificate", {
    instance_id: instanceId,
    key_id: "00000000-0000-0000-0000-000000000000",
  });
  expect(issue.status).toBeGreaterThanOrEqual(400);

  await invoke("remote-instance", accessToken, "delete", {
    idempotency_key: `mobile-qa-${crypto.randomUUID()}`,
  });

  await recordOutcome("mobile-control-plane-03-unregistered-key-rejected", {
    expectations: ["issue_certificate for an unregistered key id returns an HTTP error status."],
    details: { httpStatus: issue.status, body: issue.json },
  });
}, 60_000);
