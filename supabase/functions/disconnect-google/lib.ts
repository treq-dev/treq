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

/**
 * Revokes the user's Google grant and deletes it. Revoking the refresh token
 * also invalidates its access tokens. The row is deleted even when Google
 * refuses the revoke (an already-revoked grant answers 400), so treq never
 * keeps a token the user asked to drop.
 */
export async function disconnectGoogle(deps: {
  store: GrantStore;
  fetch: typeof fetch;
}): Promise<DisconnectResult> {
  const grant = await deps.store.load();
  if (!grant) return { status: 200, body: { disconnected: false } };

  let revoked = false;
  try {
    const res = await deps.fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: grant.refresh_token ?? grant.access_token,
      }).toString(),
    });
    revoked = res.ok;
    if (!res.ok)
      console.error("[disconnect-google] revoke failed:", res.status);
  } catch (err) {
    console.error("[disconnect-google] revoke error:", String(err));
  }

  await deps.store.remove();
  return { status: 200, body: { disconnected: true, revoked } };
}
