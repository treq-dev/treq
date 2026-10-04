// Disconnect logic for the disconnect-google Edge Function, free of Deno and
// Supabase imports so it runs under the repo's unit tests.

export type StoredGrant = {
  access_token: string;
  refresh_token: string | null;
};

export interface GrantStore {
  load(): Promise<StoredGrant | null>;
  remove(): Promise<void>;
}

export type DisconnectResult = { status: number; body: unknown };

const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

const REVOKE_TIMEOUT_MS = 5000;

/**
 * Deletes the user's Google grant, then revokes it with Google. The row goes
 * first so a slow or hanging Google can never leave treq holding a token the
 * user asked to drop; the revoke is best effort and capped by a timeout.
 * Revoking the refresh token also invalidates its access tokens. If the
 * delete fails, this throws and nothing is reported as disconnected.
 */
export async function disconnectGoogle(deps: {
  store: GrantStore;
  fetch: typeof fetch;
  revokeTimeoutMs?: number;
}): Promise<DisconnectResult> {
  const grant = await deps.store.load();
  if (!grant) return { status: 200, body: { disconnected: false } };

  await deps.store.remove();

  const timeoutMs = deps.revokeTimeoutMs ?? REVOKE_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const revoke = (async () => {
    try {
      const res = await deps.fetch(REVOKE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: grant.refresh_token ?? grant.access_token,
        }).toString(),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok)
        console.error("[disconnect-google] revoke failed:", res.status);
      return res.ok;
    } catch (err) {
      console.error("[disconnect-google] revoke error:", String(err));
      return false;
    }
  })();
  // The race also covers a fetch that ignores its abort signal.
  const revoked = await Promise.race([revoke, timeout]);
  clearTimeout(timer);
  return { status: 200, body: { disconnected: true, revoked } };
}
