import TreqSsh, { ExecResult } from '../native/TreqSsh';

/**
 * Phase 6 of prds/mobile.md: "idempotent mutation retry tests". Mobile has
 * no post-reconnect state-verification read the way desktop's
 * `retry_after_reconnect` (`core::remote`) does - that needs a typed read
 * command per mutation kind, which is a larger follow-up. What this does
 * cover: a transport-level failure (the exec channel itself throwing -
 * a dropped SSH session, not a structured CLI error) retries the *same*
 * `treq <command> ... --idempotency-key <key>` argv, so a retried mutation
 * that actually landed on the VM before the connection dropped is not
 * double-applied when the retry lands too - `with_idempotency_key`
 * (`core::remote`) de-dupes by key on the VM side regardless of how many
 * times the same key arrives.
 *
 * A non-zero `exitStatus` (a structured CLI error, e.g. invalid_arguments)
 * is not retried - retrying would just repeat the same error.
 */
export type RetryOptions = {
  maxAttempts?: number;
  /** Milliseconds to wait before each retry attempt (index 0 = first retry). */
  backoffMs?: (attempt: number) => number;
};

const DEFAULT_MAX_ATTEMPTS = 3;
const defaultBackoffMs = (attempt: number): number => Math.min(4000, 250 * 2 ** attempt);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `argv` over `sessionId`, retrying up to `maxAttempts` times on a
 * transport-level failure (a thrown error) while reusing the exact same
 * argv - and therefore the same idempotency key already baked into it by
 * the caller (see `generateIdempotencyKey` in `controlPlane.ts`) - on
 * every attempt. Does not retry a completed exec with a non-zero exit
 * status; that is a structured CLI error, not a dropped connection.
 */
export async function runMutationWithRetry(
  sessionId: string,
  argv: string[],
  options: RetryOptions = {},
): Promise<ExecResult> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const backoffMs = options.backoffMs ?? defaultBackoffMs;

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await TreqSsh.execCommand(sessionId, argv);
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts - 1) {
        await sleep(backoffMs(attempt));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
