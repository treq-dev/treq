/**
 * Mirrors `src/lib/remote-control-plane.ts` (desktop) for the calls mobile
 * needs in Phase 2: registering a device's public key and obtaining a
 * short-lived SSH certificate for a managed instance. Request/response
 * types are imported directly from `src/lib/api-types-remote.ts` (pure
 * TypeScript, no React/RN-specific code) rather than duplicated, so the
 * two clients cannot silently drift on shape.
 *
 * Desktop's token-exchange step (`exchangeToken` in
 * `src/stores/authStore.ts`) is reused as-is here too: there is no
 * mobile-specific `exchange-mobile-token` edge function, so this hits the
 * same `exchange-desktop-token` endpoint. See `authStore.ts` in this
 * directory for why (no native deep-link handler exists yet - see
 * mobile/README.md).
 */
import type {
  ClientKeyResponse,
  IssueCertificateRequest,
  IssueCertificateResponse,
  RegisterClientKeyRequest,
  RegisterClientKeyResponse,
} from '../../../src/lib/api-types-remote';
import { environment } from './env';
import { supabase } from './supabaseClient';

/**
 * `crypto.randomUUID` isn't guaranteed to exist in the React Native JS
 * runtime without a native polyfill this app doesn't have yet, so
 * idempotency keys use this instead - collision-resistant enough for a
 * per-request key, not cryptographic randomness.
 */
export function generateIdempotencyKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function invokeRemoteTrust<T>(action: string, body: object = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>('remote-ssh-trust', {
    body: { action, ...body },
  });
  if (error) {
    throw new Error(error.message);
  }
  return data as T;
}

/**
 * Exchanges a one-time token (obtained from the web sign-in flow) for a
 * Supabase session, the same way desktop's `authStore.exchangeToken` does.
 */
export async function exchangeToken(token: string): Promise<void> {
  const response = await fetch(`${environment.supabaseUrl}/functions/v1/exchange-desktop-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${environment.supabaseAnonKey}`,
      apikey: environment.supabaseAnonKey,
    },
    body: JSON.stringify({ token }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${body}`);
  }

  const { access_token, refresh_token } = (await response.json()) as {
    access_token: string;
    refresh_token: string;
  };

  const { error } = await supabase.auth.setSession({ access_token, refresh_token });
  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Registers a device's public key with the control plane, normalizing the
 * edge function's two response shapes (a freshly registered `key`, or a
 * `keys` list on an idempotent replay) down to the single matching key -
 * same normalization desktop's `registerClientKey` does.
 */
export async function registerClientKey(request: RegisterClientKeyRequest): Promise<ClientKeyResponse> {
  const response = await invokeRemoteTrust<RegisterClientKeyResponse>('register_client_key', request);

  if (response.key) {
    return response.key;
  }
  const match = response.keys?.find((k) => k.comment === request.comment);
  if (match) {
    return match;
  }
  if (response.keys?.length) {
    return response.keys[0];
  }
  throw new Error('register_client_key returned neither a key nor a keys list');
}

export async function issueCertificate(request: IssueCertificateRequest): Promise<IssueCertificateResponse> {
  return invokeRemoteTrust<IssueCertificateResponse>('issue_certificate', request);
}
