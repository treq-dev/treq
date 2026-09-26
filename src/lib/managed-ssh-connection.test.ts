// TDD: written before `managed-ssh-connection.ts` exists. Covers the gap
// described in prds/remote-development.md ("Managed VM certificate flow") that the
// old `RemoteManagedSetupPanel`/`Dashboard` wiring left open: the selected
// local SSH identity's public key was never registered, no certificate was
// ever issued, and no managed `SshEndpoint` was ever activated.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectExistingReadyInstance,
  connectManagedInstance,
  reauthenticateManagedInstance,
  type ManagedConnectionDeps,
} from "./managed-ssh-connection";
import type {
  ClientKeyResponse,
  InstanceStatusResponse,
  IssueCertificateResponse,
  ManagedInstanceRecord,
} from "./api-types-remote";

const PUBLIC_KEY = "ssh-ed25519 AAAA... test@example";

function makeInstance(
  status: ManagedInstanceRecord["status"],
  generation = 1,
): ManagedInstanceRecord {
  return {
    instance_id: "inst-1",
    owner_user_id: "user-1",
    provider_kind: "fly_sprites",
    provider_resource_id: "sprite-1",
    region: "us_east",
    size_preset: "small",
    status,
    generation,
    endpoint_id: "endpoint-1",
    image_manifest_version: 1,
    created_at: "2024-01-01T00:00:00Z",
    ready_at: status === "ready" ? "2024-01-01T00:05:00Z" : null,
    disk_quota_gb: 5,
    vcpu_quota: 1,
    ram_quota_gb: 2,
  };
}

const KEY: ClientKeyResponse = {
  id: "key-1",
  algorithm: "ssh-ed25519",
  fingerprint_sha256: "SHA256:abc",
  comment: "treq-managed-vm",
  created_at: "2024-01-01T00:00:00Z",
  revoked_at: null,
};

function makeCertResponse(generation = 1): IssueCertificateResponse {
  return {
    certificate: "ssh-ed25519-cert-v01@openssh.com AAAA...",
    serial: "serial-1",
    expires_at: new Date(Date.now() + 20 * 60_000).toISOString(),
    endpoint: {
      id: "endpoint-1",
      instance_id: "inst-1",
      source: { type: "managed", provider: "fly_sprites", generation },
      hostname: "inst-1.fly.dev",
      port: 22,
      username: "treq",
      host_keys: [
        {
          algorithm: "ssh-ed25519",
          fingerprint_sha256: "SHA256:hostkey",
          comment: null,
        },
      ],
      authentication: { type: "certificate", key_reference: "key-1" },
    },
  };
}

function makeDeps(
  overrides: Partial<ManagedConnectionDeps> = {},
): ManagedConnectionDeps {
  return {
    readPublicKey: vi.fn().mockResolvedValue(PUBLIC_KEY),
    registerClientKey: vi.fn().mockResolvedValue(KEY),
    ensureInstance: vi.fn().mockResolvedValue({
      operation_id: "op-1",
      status: "in_progress",
    }),
    getInstanceStatus: vi.fn().mockResolvedValue({
      instance: makeInstance("ready"),
      endpoint: null,
    } satisfies InstanceStatusResponse),
    issueCertificate: vi.fn().mockResolvedValue(makeCertResponse()),
    activateEndpoint: vi.fn(),
    startRenewal: vi.fn().mockReturnValue({ stop: vi.fn() }),
    clearCutoff: vi.fn().mockResolvedValue(undefined),
    sleep: vi.fn().mockResolvedValue(undefined),
    now: () => 0,
    ...overrides,
  };
}

describe("connectManagedInstance", () => {
  let deps: ManagedConnectionDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  it("resolves the local identity's public key without ever touching a private key", async () => {
    await connectManagedInstance(deps, {
      region: "us_east",
      size: "small",
      keyReference: "/home/user/.ssh/id_ed25519.pub",
    });
    expect(deps.readPublicKey).toHaveBeenCalledWith(
      "/home/user/.ssh/id_ed25519.pub",
    );
    // No API in ManagedConnectionDeps exposes a private key at all - this is
    // a structural guarantee, but assert readPublicKey's return value (the
    // public key text) is what gets registered, not the reference itself.
    expect(deps.registerClientKey).toHaveBeenCalledWith(
      PUBLIC_KEY,
      expect.any(String),
      expect.any(String),
    );
  });

  it("registers the public key with a stable idempotency key across repeated calls", async () => {
    const registerClientKey = vi
      .fn()
      .mockResolvedValue(KEY) as ManagedConnectionDeps["registerClientKey"];
    deps = makeDeps({ registerClientKey });

    await connectManagedInstance(deps, {
      region: "us_east",
      size: "small",
      keyReference: "/home/user/.ssh/id_ed25519.pub",
    });
    await connectManagedInstance(deps, {
      region: "us_east",
      size: "small",
      keyReference: "/home/user/.ssh/id_ed25519.pub",
    });

    const { calls } = (registerClientKey as ReturnType<typeof vi.fn>).mock;
    expect(calls[0][2]).toEqual(calls[1][2]); // idempotency key argument
  });

  it("provisions or reuses the instance, then polls readiness until connectable", async () => {
    const getInstanceStatus = vi
      .fn()
      .mockResolvedValueOnce({
        instance: makeInstance("provisioning"),
        endpoint: null,
      })
      .mockResolvedValueOnce({
        instance: makeInstance("bootstrapping"),
        endpoint: null,
      })
      .mockResolvedValueOnce({
        instance: makeInstance("ready"),
        endpoint: null,
      });
    deps = makeDeps({ getInstanceStatus });

    await connectManagedInstance(deps, {
      region: "us_east",
      size: "small",
      keyReference: "ref",
    });

    expect(deps.ensureInstance).toHaveBeenCalledTimes(1);
    expect(getInstanceStatus).toHaveBeenCalledTimes(3);
  });

  it("surfaces a readiness failure instead of polling forever", async () => {
    const getInstanceStatus = vi.fn().mockResolvedValue({
      instance: makeInstance("failed"),
      endpoint: null,
    });
    deps = makeDeps({ getInstanceStatus });

    await expect(
      connectManagedInstance(deps, {
        region: "us_east",
        size: "small",
        keyReference: "ref",
      }),
    ).rejects.toThrow(/failed/i);
  });

  it("requests the initial certificate and activates the endpoint with instance id, generation, host keys, and certificate auth", async () => {
    const result = await connectManagedInstance(deps, {
      region: "us_east",
      size: "small",
      keyReference: "ref",
    });

    expect(deps.issueCertificate).toHaveBeenCalledWith("inst-1", "key-1");
    expect(deps.activateEndpoint).toHaveBeenCalledTimes(1);
    const [[activated]] = (deps.activateEndpoint as ReturnType<typeof vi.fn>)
      .mock.calls;
    expect(activated.instance_id).toBe("inst-1");
    expect(activated.source).toEqual({
      type: "managed",
      provider: "fly_sprites",
      generation: 1,
    });
    expect(activated.host_keys).toHaveLength(1);
    expect(activated.authentication).toEqual({
      type: "certificate",
      key_reference: "key-1",
    });
    expect(result.endpoint).toBe(activated);
  });

  it("starts silent certificate renewal once the endpoint is active", async () => {
    await connectManagedInstance(deps, {
      region: "us_east",
      size: "small",
      keyReference: "ref",
    });
    expect(deps.startRenewal).toHaveBeenCalledTimes(1);
    const [[lease]] = (deps.startRenewal as ReturnType<typeof vi.fn>).mock
      .calls;
    expect(lease.instanceId).toBe("inst-1");
    expect(lease.keyId).toBe("key-1");
    expect(lease.endpointId).toBe("endpoint-1");
  });
});

describe("connectExistingReadyInstance", () => {
  it("skips provisioning and readiness polling for an already-ready instance", async () => {
    const deps = makeDeps();
    const status: InstanceStatusResponse = {
      instance: makeInstance("ready"),
      endpoint: null,
    };

    await connectExistingReadyInstance(deps, {
      status,
      keyReference: "ref",
    });

    expect(deps.ensureInstance).not.toHaveBeenCalled();
    expect(deps.issueCertificate).toHaveBeenCalledWith("inst-1", "key-1");
    expect(deps.activateEndpoint).toHaveBeenCalledTimes(1);
    expect(deps.startRenewal).toHaveBeenCalledTimes(1);
  });

  it("rejects when the instance is not actually ready", async () => {
    const deps = makeDeps();
    const status: InstanceStatusResponse = {
      instance: makeInstance("suspended"),
      endpoint: null,
    };
    await expect(
      connectExistingReadyInstance(deps, { status, keyReference: "ref" }),
    ).rejects.toThrow(/not ready/i);
  });
});

describe("reauthenticateManagedInstance", () => {
  it("clears cutoff only after fresh certificate issuance succeeds", async () => {
    const order: string[] = [];
    const deps = makeDeps({
      issueCertificate: vi.fn().mockImplementation(async () => {
        order.push("issue");
        return makeCertResponse();
      }),
      clearCutoff: vi.fn().mockImplementation(async () => {
        order.push("clear");
      }),
    });

    await reauthenticateManagedInstance(deps, {
      instanceId: "inst-1",
      endpointId: "endpoint-1",
      keyReference: "ref",
    });

    expect(order).toEqual(["issue", "clear"]);
    expect(deps.activateEndpoint).toHaveBeenCalledTimes(1);
    expect(deps.startRenewal).toHaveBeenCalledTimes(1);
  });

  it("does not clear cutoff when certificate issuance fails", async () => {
    const deps = makeDeps({
      issueCertificate: vi.fn().mockRejectedValue(new Error("revoked")),
    });

    await expect(
      reauthenticateManagedInstance(deps, {
        instanceId: "inst-1",
        endpointId: "endpoint-1",
        keyReference: "ref",
      }),
    ).rejects.toThrow("revoked");
    expect(deps.clearCutoff).not.toHaveBeenCalled();
    expect(deps.activateEndpoint).not.toHaveBeenCalled();
  });
});
