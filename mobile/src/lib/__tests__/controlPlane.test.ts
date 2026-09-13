jest.mock('../supabaseClient', () => ({
  supabase: {
    functions: { invoke: jest.fn() },
    auth: { setSession: jest.fn() },
  },
}));

import { supabase } from '../supabaseClient';
import { exchangeToken, issueCertificate, registerClientKey } from '../controlPlane';

const originalFetch = global.fetch;

describe('registerClientKey', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns `key` when the edge function registers a fresh key', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({
      data: { operation_id: 'op1', status: 'succeeded', key: { id: 'k1', algorithm: 'ssh-ed25519', fingerprint_sha256: 'SHA256:x', comment: 'phone', created_at: 't', revoked_at: null } },
      error: null,
    });

    const result = await registerClientKey({ public_key: 'ssh-ed25519 AAAA', comment: 'phone', idempotency_key: 'idem1' });

    expect(result.id).toBe('k1');
    expect(supabase.functions.invoke).toHaveBeenCalledWith('remote-ssh-trust', {
      body: { action: 'register_client_key', public_key: 'ssh-ed25519 AAAA', comment: 'phone', idempotency_key: 'idem1' },
    });
  });

  it('falls back to matching `keys` by comment on an idempotent replay', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({
      data: {
        operation_id: 'op1', status: 'succeeded',
        keys: [
          { id: 'other', algorithm: 'ssh-ed25519', fingerprint_sha256: 'SHA256:y', comment: 'laptop', created_at: 't', revoked_at: null },
          { id: 'k1', algorithm: 'ssh-ed25519', fingerprint_sha256: 'SHA256:x', comment: 'phone', created_at: 't', revoked_at: null },
        ],
      },
      error: null,
    });

    const result = await registerClientKey({ public_key: 'ssh-ed25519 AAAA', comment: 'phone', idempotency_key: 'idem1' });
    expect(result.id).toBe('k1');
  });

  it('throws when the edge function returns an error', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: null, error: { message: 'unauthorized' } });

    await expect(
      registerClientKey({ public_key: 'ssh-ed25519 AAAA', comment: null, idempotency_key: 'idem1' }),
    ).rejects.toThrow('unauthorized');
  });
});

describe('issueCertificate', () => {
  beforeEach(() => jest.clearAllMocks());

  it('invokes issue_certificate and returns the response', async () => {
    const response = {
      certificate: 'ssh-ed25519-cert-v01@openssh.com AAAA...',
      serial: '1',
      expires_at: '2026-01-01T00:00:00Z',
      endpoint: {
        id: 'ep1', instance_id: 'inst1', source: { type: 'managed', provider: 'fly_sprites', generation: 1 },
        hostname: '1.2.3.4', port: 22, username: 'treq',
        host_keys: [{ algorithm: 'ssh-ed25519', fingerprint_sha256: 'SHA256:abc', comment: null }],
        authentication: { type: 'certificate', key_reference: 'k1' },
      },
    };
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: response, error: null });

    const result = await issueCertificate({ instance_id: 'inst1', key_id: 'k1' });
    expect(result).toEqual(response);
    expect(supabase.functions.invoke).toHaveBeenCalledWith('remote-ssh-trust', {
      body: { action: 'issue_certificate', instance_id: 'inst1', key_id: 'k1' },
    });
  });
});

describe('exchangeToken', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('exchanges a token for a session and sets it on the supabase client', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'at', refresh_token: 'rt' }),
    });
    (supabase.auth.setSession as jest.Mock).mockResolvedValue({ error: null });

    await exchangeToken('one-time-token');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/functions/v1/exchange-desktop-token'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(supabase.auth.setSession).toHaveBeenCalledWith({ access_token: 'at', refresh_token: 'rt' });
  });

  it('throws when the exchange endpoint responds with an error status', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 401, text: async () => 'invalid token' });

    await expect(exchangeToken('bad-token')).rejects.toThrow(/401/);
  });
});
