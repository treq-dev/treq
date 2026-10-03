import { describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("./supabase", () => ({ supabase: { functions: { invoke } } }));

import {
  CertificateRenewalManager,
  classifyRenewalError,
  renewalDelayMs,
  RENEWAL_REMAINING_LIFETIME_FRACTION,
} from "./remote-cert-lifecycle";
import type { IssueCertificateResponse } from "./api-types-remote";
import { issueCertificate } from "./remote-control-plane";

/** Fails `issueCertificate` the way supabase-js reports a non-2xx Edge
 * Function response, and returns what the real client wrapper throws. */
async function renewalFailure(status: number, error: string): Promise<unknown> {
  invoke.mockResolvedValueOnce({
    data: null,
    error: {
      message: "Edge Function returned a non-2xx status code",
      context: new Response(JSON.stringify({ error }), { status }),
    },
  });
  return issueCertificate({ instance_id: "i", key_id: "k" }).catch(
    (thrown: unknown) => thrown,
  );
}

function response(expiresAt: number): IssueCertificateResponse {
  return {
    certificate: "cert-line",
    serial: "1",
    expires_at: new Date(expiresAt).toISOString(),
    endpoint: {
      id: "endpoint-1",
      instance_id: "instance-1",
      source: { type: "managed", provider: "fly_sprites", generation: 1 },
      hostname: "host",
      port: 22,
      username: "treq",
      host_keys: [],
      authentication: { type: "certificate", key_reference: "key-1" },
    },
  };
}

describe("renewalDelayMs", () => {
  it("schedules renewal once 20% of the lifetime remains", () => {
    const issuedAt = 0;
    const expiresAt = 1000;
    // 80% elapsed = renew at t=800.
    expect(renewalDelayMs(issuedAt, expiresAt, 0)).toBe(800);
    expect(renewalDelayMs(issuedAt, expiresAt, 800)).toBe(0);
    expect(RENEWAL_REMAINING_LIFETIME_FRACTION).toBe(0.2);
  });

  it("never returns a negative delay for an already-late renewal", () => {
    expect(renewalDelayMs(0, 1000, 950)).toBe(0);
  });

  it("returns 0 for a non-positive lifetime", () => {
    expect(renewalDelayMs(1000, 1000, 500)).toBe(0);
    expect(renewalDelayMs(1000, 500, 500)).toBe(0);
  });
});

describe("classifyRenewalError", () => {
  it("treats an expired Supabase session (401) as non-retryable", async () => {
    expect(
      classifyRenewalError(await renewalFailure(401, "Unauthorized")),
    ).toBe("session_ended");
  });

  it("treats a revoked or deleted key as non-retryable", async () => {
    expect(
      classifyRenewalError(await renewalFailure(409, "Key has been revoked")),
    ).toBe("key_revoked");
    expect(
      classifyRenewalError(
        await renewalFailure(404, "Key does not belong to this user"),
      ),
    ).toBe("key_revoked");
  });

  it("treats an inaccessible instance (404, or a 409 for other reasons) as non-retryable", async () => {
    expect(
      classifyRenewalError(
        await renewalFailure(404, "Instance does not belong to this user"),
      ),
    ).toBe("instance_inaccessible");
    expect(
      classifyRenewalError(
        await renewalFailure(409, "Instance is not ready (status: suspended)"),
      ),
    ).toBe("instance_inaccessible");
  });

  it("still reads a raw supabase-js error's response status", () => {
    expect(classifyRenewalError({ context: { status: 401 } })).toBe(
      "session_ended",
    );
  });

  it("treats a transient network/5xx failure as retryable", async () => {
    expect(classifyRenewalError(await renewalFailure(503, "busy"))).toBe(
      "retry",
    );
    expect(classifyRenewalError(new TypeError("Failed to fetch"))).toBe(
      "retry",
    );
  });
});

describe("CertificateRenewalManager", () => {
  it("renews transparently while the session stays valid, without ever cutting off", async () => {
    vi.useFakeTimers();
    const now = { value: 0 };
    const issue = vi
      .fn()
      .mockResolvedValueOnce(response(1000))
      .mockResolvedValueOnce(response(2000));
    const onRenewed = vi.fn();
    const onCutoff = vi.fn();

    new CertificateRenewalManager({
      instanceId: "instance-1",
      keyId: "key-1",
      endpointId: "endpoint-1",
      initialLease: { issuedAt: 0, expiresAt: 1000 },
      isSessionValid: () => true,
      issue: (instanceId, keyId) => issue(instanceId, keyId),
      onRenewed: (lease) => onRenewed(lease),
      onCutoff: (reason) => onCutoff(reason),
      now: () => now.value,
    });

    // Renewal is scheduled at 80% of the lifetime (t=800), well before the
    // certificate would actually lapse at t=1000 - the channel is never
    // interrupted because the certificate never expires unrenewed.
    now.value = 800;
    await vi.advanceTimersByTimeAsync(800);

    expect(issue).toHaveBeenCalledWith("instance-1", "key-1");
    expect(onRenewed).toHaveBeenCalledWith(
      expect.objectContaining({
        expiresAt: 1000,
        serial: "1",
        certificate: "cert-line",
      }),
    );
    expect(onCutoff).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("cuts off immediately, without retrying, when the session has ended", async () => {
    vi.useFakeTimers();
    const onCutoff = vi.fn();
    const issue = vi.fn();

    new CertificateRenewalManager({
      instanceId: "instance-1",
      keyId: "key-1",
      endpointId: "endpoint-1",
      initialLease: { issuedAt: 0, expiresAt: 1000 },
      isSessionValid: () => false,
      issue,
      onRenewed: () => {},
      onCutoff: (reason) => onCutoff(reason),
      now: () => 800,
    });

    await vi.advanceTimersByTimeAsync(800);

    expect(issue).not.toHaveBeenCalled();
    expect(onCutoff).toHaveBeenCalledWith("session_ended");
    expect(onCutoff).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("cuts off without retrying when renewal is refused because the key was revoked", async () => {
    vi.useFakeTimers();
    const onCutoff = vi.fn();
    const issue = vi.fn().mockRejectedValue({
      context: { status: 409 },
      message: "Key has been revoked",
    });

    new CertificateRenewalManager({
      instanceId: "instance-1",
      keyId: "key-1",
      endpointId: "endpoint-1",
      initialLease: { issuedAt: 0, expiresAt: 1000 },
      isSessionValid: () => true,
      issue,
      onRenewed: () => {},
      onCutoff: (reason) => onCutoff(reason),
      now: () => 800,
    });

    await vi.advanceTimersByTimeAsync(800);

    expect(issue).toHaveBeenCalledTimes(1);
    expect(onCutoff).toHaveBeenCalledWith("key_revoked");

    vi.useRealTimers();
  });

  it("retries a transient failure and still renews before the certificate expires", async () => {
    vi.useFakeTimers();
    const now = { value: 800 };
    const onCutoff = vi.fn();
    const onRenewed = vi.fn();
    const issue = vi
      .fn()
      .mockRejectedValueOnce({ context: { status: 503 } })
      .mockImplementationOnce(() =>
        Promise.resolve(response(now.value + 500_000)),
      );

    new CertificateRenewalManager({
      instanceId: "instance-1",
      keyId: "key-1",
      endpointId: "endpoint-1",
      initialLease: { issuedAt: 0, expiresAt: 600_000 },
      isSessionValid: () => true,
      issue,
      onRenewed: (lease) => onRenewed(lease),
      onCutoff: (reason) => onCutoff(reason),
      now: () => now.value,
    });

    // First attempt at t=480000 (80% of 600000) fails transiently, with
    // plenty of the certificate's lifetime (120s) still left for a retry.
    now.value = 480_000;
    await vi.advanceTimersByTimeAsync(480_000);
    expect(issue).toHaveBeenCalledTimes(1);
    expect(onCutoff).not.toHaveBeenCalled();

    // Backoff retry (15s) succeeds well before the certificate expires.
    now.value = 480_015;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(issue.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(onRenewed).toHaveBeenCalled();
    expect(onCutoff).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("lets the certificate lapse (certificate_expired) if retries never land before expiry", async () => {
    vi.useFakeTimers();
    const now = { value: 0 };
    const onCutoff = vi.fn();
    const issue = vi.fn().mockRejectedValue({ context: { status: 503 } });

    new CertificateRenewalManager({
      instanceId: "instance-1",
      keyId: "key-1",
      endpointId: "endpoint-1",
      // Short-lived certificate with no time left for a retry once the
      // first renewal attempt (itself already at 80% of lifetime) fails.
      initialLease: { issuedAt: 0, expiresAt: 1000 },
      isSessionValid: () => true,
      issue,
      onRenewed: () => {},
      onCutoff: (reason) => onCutoff(reason),
      now: () => now.value,
    });

    now.value = 800;
    await vi.advanceTimersByTimeAsync(800);
    expect(onCutoff).not.toHaveBeenCalled();

    // The retry backoff (15s) would land after the certificate's t=1000
    // expiry, so the manager lets it lapse instead of retrying past expiry.
    now.value = 1000;
    await vi.advanceTimersByTimeAsync(200);
    expect(onCutoff).toHaveBeenCalledWith("certificate_expired");

    vi.useRealTimers();
  });

  it("stop() prevents any further renewal or cutoff", async () => {
    vi.useFakeTimers();
    const onCutoff = vi.fn();
    const issue = vi.fn();

    const manager = new CertificateRenewalManager({
      instanceId: "instance-1",
      keyId: "key-1",
      endpointId: "endpoint-1",
      initialLease: { issuedAt: 0, expiresAt: 1000 },
      isSessionValid: () => false,
      issue,
      onRenewed: () => {},
      onCutoff: (reason) => onCutoff(reason),
      now: () => 800,
    });
    manager.stop();

    await vi.advanceTimersByTimeAsync(1000);
    expect(issue).not.toHaveBeenCalled();
    expect(onCutoff).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
