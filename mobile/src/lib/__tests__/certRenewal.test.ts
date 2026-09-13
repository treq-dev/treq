import {
  CertificateRenewalManager,
  classifyRenewalError,
  renewalDelayMs,
  RENEWAL_REMAINING_LIFETIME_FRACTION,
} from '../certRenewal';
import type { IssueCertificateResponse } from '../../../../src/lib/api-types-remote';

// Ported from src/lib/remote-cert-lifecycle.test.ts (desktop) - same
// algorithm, same test cases, translated from vitest to Jest fake timers.
// See certRenewal.ts's module doc for why this isn't a direct import.

function response(expiresAt: number): IssueCertificateResponse {
  return {
    certificate: 'cert-line',
    serial: '1',
    expires_at: new Date(expiresAt).toISOString(),
    endpoint: {
      id: 'endpoint-1',
      instance_id: 'instance-1',
      source: { type: 'managed', provider: 'fly_sprites', generation: 1 },
      hostname: 'host',
      port: 22,
      username: 'treq',
      host_keys: [],
      authentication: { type: 'certificate', key_reference: 'key-1' },
    },
  };
}

describe('renewalDelayMs', () => {
  it('schedules renewal once 20% of the lifetime remains', () => {
    expect(renewalDelayMs(0, 1000, 0)).toBe(800);
    expect(renewalDelayMs(0, 1000, 800)).toBe(0);
    expect(RENEWAL_REMAINING_LIFETIME_FRACTION).toBe(0.2);
  });

  it('never returns a negative delay for an already-late renewal', () => {
    expect(renewalDelayMs(0, 1000, 950)).toBe(0);
  });

  it('returns 0 for a non-positive lifetime', () => {
    expect(renewalDelayMs(1000, 1000, 500)).toBe(0);
    expect(renewalDelayMs(1000, 500, 500)).toBe(0);
  });
});

describe('classifyRenewalError', () => {
  it('treats an expired Supabase session (401) as non-retryable', () => {
    expect(classifyRenewalError({ context: { status: 401 } })).toBe('session_ended');
  });

  it('treats a revoked key (409, message mentions revoked) as non-retryable', () => {
    expect(classifyRenewalError({ context: { status: 409 }, message: 'Key has been revoked' })).toBe('key_revoked');
  });

  it('treats an inaccessible instance (404, or a 409 for other reasons) as non-retryable', () => {
    expect(classifyRenewalError({ context: { status: 404 } })).toBe('instance_inaccessible');
    expect(classifyRenewalError({ context: { status: 409 }, message: 'Instance is not ready (status: suspended)' }))
      .toBe('instance_inaccessible');
  });

  it('treats a transient network/5xx failure as retryable', () => {
    expect(classifyRenewalError({ context: { status: 503 } })).toBe('retry');
    expect(classifyRenewalError(new TypeError('Failed to fetch'))).toBe('retry');
  });
});

describe('CertificateRenewalManager', () => {
  it('renews transparently while the session stays valid, without ever cutting off', async () => {
    jest.useFakeTimers();
    const now = { value: 0 };
    const issue = jest.fn()
      .mockResolvedValueOnce(response(1000))
      .mockResolvedValueOnce(response(2000));
    const onRenewed = jest.fn();
    const onCutoff = jest.fn();

    new CertificateRenewalManager({
      instanceId: 'instance-1',
      keyId: 'key-1',
      sessionId: 'session-1',
      initialLease: { issuedAt: 0, expiresAt: 1000 },
      isSessionValid: () => true,
      issue: (instanceId, keyId) => issue(instanceId, keyId),
      onRenewed: (lease) => onRenewed(lease),
      onCutoff: (reason) => onCutoff(reason),
      now: () => now.value,
    });

    now.value = 800;
    await jest.advanceTimersByTimeAsync(800);

    expect(issue).toHaveBeenCalledWith('instance-1', 'key-1');
    expect(onRenewed).toHaveBeenCalledWith(expect.objectContaining({ expiresAt: 1000, serial: '1' }));
    expect(onCutoff).not.toHaveBeenCalled();

    jest.useRealTimers();
  });

  it('cuts off immediately, without retrying, when the session has ended', async () => {
    jest.useFakeTimers();
    const onCutoff = jest.fn();
    const issue = jest.fn();

    new CertificateRenewalManager({
      instanceId: 'instance-1',
      keyId: 'key-1',
      sessionId: 'session-1',
      initialLease: { issuedAt: 0, expiresAt: 1000 },
      isSessionValid: () => false,
      issue,
      onRenewed: () => {},
      onCutoff: (reason) => onCutoff(reason),
      now: () => 800,
    });

    await jest.advanceTimersByTimeAsync(800);

    expect(issue).not.toHaveBeenCalled();
    expect(onCutoff).toHaveBeenCalledWith('session_ended');
    expect(onCutoff).toHaveBeenCalledTimes(1);

    jest.useRealTimers();
  });

  it('cuts off without retrying when renewal is refused because the key was revoked', async () => {
    jest.useFakeTimers();
    const onCutoff = jest.fn();
    const issue = jest.fn().mockRejectedValue({ context: { status: 409 }, message: 'Key has been revoked' });

    new CertificateRenewalManager({
      instanceId: 'instance-1',
      keyId: 'key-1',
      sessionId: 'session-1',
      initialLease: { issuedAt: 0, expiresAt: 1000 },
      isSessionValid: () => true,
      issue,
      onRenewed: () => {},
      onCutoff: (reason) => onCutoff(reason),
      now: () => 800,
    });

    await jest.advanceTimersByTimeAsync(800);

    expect(issue).toHaveBeenCalledTimes(1);
    expect(onCutoff).toHaveBeenCalledWith('key_revoked');

    jest.useRealTimers();
  });

  it('retries a transient failure and still renews before the certificate expires', async () => {
    jest.useFakeTimers();
    const now = { value: 800 };
    const onCutoff = jest.fn();
    const onRenewed = jest.fn();
    const issue = jest.fn()
      .mockRejectedValueOnce({ context: { status: 503 } })
      .mockImplementationOnce(() => Promise.resolve(response(now.value + 500_000)));

    new CertificateRenewalManager({
      instanceId: 'instance-1',
      keyId: 'key-1',
      sessionId: 'session-1',
      initialLease: { issuedAt: 0, expiresAt: 600_000 },
      isSessionValid: () => true,
      issue,
      onRenewed: (lease) => onRenewed(lease),
      onCutoff: (reason) => onCutoff(reason),
      now: () => now.value,
    });

    now.value = 480_000;
    await jest.advanceTimersByTimeAsync(480_000);
    expect(issue).toHaveBeenCalledTimes(1);
    expect(onCutoff).not.toHaveBeenCalled();

    now.value = 480_015;
    await jest.advanceTimersByTimeAsync(15_000);
    expect(issue.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(onRenewed).toHaveBeenCalled();
    expect(onCutoff).not.toHaveBeenCalled();

    jest.useRealTimers();
  });

  it('lets the certificate lapse (certificate_expired) if retries never land before expiry', async () => {
    jest.useFakeTimers();
    const now = { value: 0 };
    const onCutoff = jest.fn();
    const issue = jest.fn().mockRejectedValue({ context: { status: 503 } });

    new CertificateRenewalManager({
      instanceId: 'instance-1',
      keyId: 'key-1',
      sessionId: 'session-1',
      initialLease: { issuedAt: 0, expiresAt: 1000 },
      isSessionValid: () => true,
      issue,
      onRenewed: () => {},
      onCutoff: (reason) => onCutoff(reason),
      now: () => now.value,
    });

    now.value = 800;
    await jest.advanceTimersByTimeAsync(800);
    expect(onCutoff).not.toHaveBeenCalled();

    now.value = 1000;
    await jest.advanceTimersByTimeAsync(200);
    expect(onCutoff).toHaveBeenCalledWith('certificate_expired');

    jest.useRealTimers();
  });

  it('stop() prevents any further renewal or cutoff', async () => {
    jest.useFakeTimers();
    const onCutoff = jest.fn();
    const issue = jest.fn();

    const manager = new CertificateRenewalManager({
      instanceId: 'instance-1',
      keyId: 'key-1',
      sessionId: 'session-1',
      initialLease: { issuedAt: 0, expiresAt: 1000 },
      isSessionValid: () => false,
      issue,
      onRenewed: () => {},
      onCutoff: (reason) => onCutoff(reason),
      now: () => 800,
    });
    manager.stop();

    await jest.advanceTimersByTimeAsync(1000);
    expect(issue).not.toHaveBeenCalled();
    expect(onCutoff).not.toHaveBeenCalled();

    jest.useRealTimers();
  });

  it('onAppForeground() fires an overdue renewal immediately instead of waiting out the original timer', async () => {
    jest.useFakeTimers();
    const now = { value: 0 };
    const onRenewed = jest.fn();
    const issue = jest.fn().mockResolvedValue({ expires_at: new Date(2000).toISOString(), serial: 'serial-2' });

    const manager = new CertificateRenewalManager({
      instanceId: 'instance-1',
      keyId: 'key-1',
      sessionId: 'session-1',
      // renewAt = 800 (1000 * (1 - 0.2)), so the original timer is a 800ms delay.
      initialLease: { issuedAt: 0, expiresAt: 1000 },
      isSessionValid: () => true,
      issue,
      onRenewed: (lease) => onRenewed(lease),
      onCutoff: () => {},
      now: () => now.value,
    });

    // Simulate the app being suspended well past the original renewAt, then
    // resuming - the stale setTimeout hasn't fired yet in real device time,
    // but onAppForeground should re-anchor to `now` and renew right away.
    now.value = 5000;
    manager.onAppForeground();
    await jest.advanceTimersByTimeAsync(0);

    expect(issue).toHaveBeenCalledWith('instance-1', 'key-1');
    expect(onRenewed).toHaveBeenCalled();

    jest.useRealTimers();
  });

  it('onAppForeground() is a no-op after stop()', async () => {
    jest.useFakeTimers();
    const issue = jest.fn();
    const manager = new CertificateRenewalManager({
      instanceId: 'instance-1',
      keyId: 'key-1',
      sessionId: 'session-1',
      initialLease: { issuedAt: 0, expiresAt: 1000 },
      isSessionValid: () => true,
      issue,
      onRenewed: () => {},
      onCutoff: () => {},
      now: () => 900,
    });
    manager.stop();

    manager.onAppForeground();
    await jest.advanceTimersByTimeAsync(1000);
    expect(issue).not.toHaveBeenCalled();

    jest.useRealTimers();
  });
});
