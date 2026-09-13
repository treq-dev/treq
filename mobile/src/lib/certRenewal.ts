/**
 * Silent certificate renewal for the managed-instance path
 * (prds/remote-ssh.md, "SSH identity and certificates" > "Silent renewal
 * while the session is active" and "Hard cutoff on revocation or expiry").
 *
 * The scheduling algorithm (`renewalDelayMs`, `classifyRenewalError`,
 * `CertificateRenewalManager`) is ported from
 * `src/lib/remote-cert-lifecycle.ts` (desktop) rather than imported
 * directly: that file's core class is transport-agnostic, but the file
 * also imports Tauri-specific wiring (`./api-extra`'s `remoteForceCutoff`)
 * at module scope, which would drag a Tauri dependency into this RN app.
 * Keep this file's renewal algorithm in sync with desktop's if either
 * changes - same constants, same state machine.
 *
 * Mobile's real difference is `onCutoff`: instead of forcing a Tauri
 * transport-level cutoff, it calls `TreqSsh.disconnect` on the open SSH
 * session and lets the caller react (e.g. navigate back to a reconnect
 * screen).
 */
import type { IssueCertificateResponse } from '../../../src/lib/api-types-remote';

export const RENEWAL_REMAINING_LIFETIME_FRACTION = 0.2;

const RETRY_BACKOFF_BASE_MS = 15_000;
const MAX_RETRY_BACKOFF_MS = 2 * 60_000;

export type CutoffReason = 'session_ended' | 'key_revoked' | 'instance_inaccessible' | 'certificate_expired';

export interface CertificateLease {
  instanceId: string;
  keyId: string;
  sessionId: string;
  serial: string;
  issuedAt: number;
  expiresAt: number;
}

export function renewalDelayMs(issuedAt: number, expiresAt: number, now: number): number {
  const lifetime = expiresAt - issuedAt;
  if (lifetime <= 0) return 0;
  const renewAt = issuedAt + lifetime * (1 - RENEWAL_REMAINING_LIFETIME_FRACTION);
  return Math.max(0, renewAt - now);
}

interface FunctionsErrorLike {
  context?: { status?: number };
  message?: string;
}

function statusOf(error: unknown): number | undefined {
  const err = error as FunctionsErrorLike;
  return typeof err?.context?.status === 'number' ? err.context.status : undefined;
}

function messageOf(error: unknown): string {
  const err = error as FunctionsErrorLike;
  return typeof err?.message === 'string' ? err.message.toLowerCase() : '';
}

export function classifyRenewalError(error: unknown): 'retry' | CutoffReason {
  const status = statusOf(error);
  if (status === 401) return 'session_ended';
  if (status === 404) return 'instance_inaccessible';
  if (status === 409) {
    return messageOf(error).includes('revoked') ? 'key_revoked' : 'instance_inaccessible';
  }
  return 'retry';
}

export interface CertificateRenewalManagerOptions {
  instanceId: string;
  keyId: string;
  sessionId: string;
  initialLease: { issuedAt: number; expiresAt: number };
  isSessionValid: () => boolean | Promise<boolean>;
  issue: (instanceId: string, keyId: string) => Promise<IssueCertificateResponse>;
  onRenewed: (lease: CertificateLease) => void;
  onCutoff: (reason: CutoffReason) => void;
  now?: () => number;
}

/** Schedules silent certificate renewal for one managed-instance SSH
 * session. Never interrupts the open session itself - it only requests a
 * new certificate and, on an unrecoverable failure, hands off to
 * `onCutoff`. */
export class CertificateRenewalManager {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private retryCount = 0;
  private lease: { issuedAt: number; expiresAt: number };
  private readonly opts: CertificateRenewalManagerOptions;

  constructor(opts: CertificateRenewalManagerOptions) {
    this.opts = opts;
    this.lease = opts.initialLease;
    this.scheduleRenewal();
  }

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  private scheduleRenewal(): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    const delay = renewalDelayMs(this.lease.issuedAt, this.lease.expiresAt, this.now());
    this.timer = setTimeout(() => {
      void this.attemptRenewal();
    }, delay);
  }

  private scheduleRetry(): void {
    if (this.stopped) return;
    const backoff = Math.min(MAX_RETRY_BACKOFF_MS, RETRY_BACKOFF_BASE_MS * 2 ** this.retryCount);
    this.retryCount += 1;
    const timeLeft = this.lease.expiresAt - this.now();
    if (timeLeft <= backoff) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.cutoff('certificate_expired'), Math.max(0, timeLeft));
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.attemptRenewal();
    }, backoff);
  }

  private cutoff(reason: CutoffReason): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.opts.onCutoff(reason);
  }

  private async attemptRenewal(): Promise<void> {
    if (this.stopped) return;
    let sessionValid: boolean;
    try {
      sessionValid = await this.opts.isSessionValid();
    } catch {
      sessionValid = false;
    }
    if (!sessionValid) {
      this.cutoff('session_ended');
      return;
    }
    try {
      const response = await this.opts.issue(this.opts.instanceId, this.opts.keyId);
      this.retryCount = 0;
      const issuedAt = this.now();
      const expiresAt = Date.parse(response.expires_at);
      this.lease = { issuedAt, expiresAt };
      this.opts.onRenewed({
        instanceId: this.opts.instanceId,
        keyId: this.opts.keyId,
        sessionId: this.opts.sessionId,
        serial: response.serial,
        issuedAt,
        expiresAt,
      });
      this.scheduleRenewal();
    } catch (error) {
      const outcome = classifyRenewalError(error);
      if (outcome === 'retry') {
        this.scheduleRetry();
        return;
      }
      this.cutoff(outcome);
    }
  }

  /**
   * Re-anchors the renewal timer to the current clock. Mobile `setTimeout`
   * delays are unreliable across an OS-driven suspend (the JS timer can
   * fire very late once the app resumes, or - if the process itself was
   * killed and relaunched - not exist at all). Call this from an
   * `AppState` "active" listener so a long suspend can't leave a stale
   * timer scheduled against a delay computed before the app was
   * backgrounded: `scheduleRenewal` recomputes the remaining delay against
   * `now()`, so an overdue renewal fires immediately instead of waiting
   * out the original (now-irrelevant) delay, and an already-expired
   * certificate surfaces as the usual `classifyRenewalError` cutoff on the
   * next `issue()` call rather than silently.
   */
  onAppForeground(): void {
    this.scheduleRenewal();
  }

  /** Stops scheduling further renewals without triggering a cutoff. */
  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }
}
