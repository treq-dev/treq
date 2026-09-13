jest.mock('../../lib/controlPlane', () => ({
  ...jest.requireActual('../../lib/controlPlane'),
  registerClientKey: jest.fn(),
  issueCertificate: jest.fn(),
}));

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ManagedConnectScreen } from '../ManagedConnectScreen';
import TreqSsh from '../../native/TreqSsh';
import { issueCertificate, registerClientKey } from '../../lib/controlPlane';

const mockNavigate = jest.fn();

function renderScreen() {
  return render(
    <ManagedConnectScreen
      navigation={{ navigate: mockNavigate } as any}
      route={{ key: 'managed-connect', name: 'ManagedConnect' } as any}
    />,
  );
}

describe('ManagedConnectScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('generates a key, registers it, issues a certificate, and connects', async () => {
    (TreqSsh.generateDeviceKey as jest.Mock).mockResolvedValue({
      publicKeyOpenSsh: 'ssh-ed25519 AAAA', fingerprintSha256: 'SHA256:device', keyHandle: 'handle-1',
    });
    (registerClientKey as jest.Mock).mockResolvedValue({
      id: 'key-1', algorithm: 'ssh-ed25519', fingerprint_sha256: 'SHA256:device', comment: 'React Native device', created_at: 't', revoked_at: null,
    });
    (issueCertificate as jest.Mock).mockResolvedValue({
      certificate: 'ssh-ed25519-cert-v01@openssh.com AAAA...',
      serial: '1',
      expires_at: '2026-01-01T00:00:00Z',
      endpoint: {
        id: 'ep1', instance_id: 'inst1', source: { type: 'managed', provider: 'fly_sprites', generation: 1 },
        hostname: 'vm.example.com', port: 22, username: 'treq',
        host_keys: [{ algorithm: 'ssh-ed25519', fingerprint_sha256: 'SHA256:host', comment: null }],
        authentication: { type: 'certificate', key_reference: 'key-1' },
      },
    });
    (TreqSsh.connectWithCertificate as jest.Mock).mockResolvedValue('session-1');

    const { getByText, getByPlaceholderText } = renderScreen();
    fireEvent.changeText(getByPlaceholderText('instance-id'), 'inst1');
    fireEvent.press(getByText('Connect'));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Workspaces', { sessionId: 'session-1' }));

    expect(registerClientKey).toHaveBeenCalledWith({
      public_key: 'ssh-ed25519 AAAA', comment: 'React Native device', idempotency_key: expect.any(String),
    });
    expect(issueCertificate).toHaveBeenCalledWith({ instance_id: 'inst1', key_id: 'key-1' });
    expect(TreqSsh.connectWithCertificate).toHaveBeenCalledWith(
      'vm.example.com', 22, 'treq', 'handle-1', 'ssh-ed25519-cert-v01@openssh.com AAAA...', 'SHA256:host',
    );
  });

  it('surfaces an error from the control plane', async () => {
    (TreqSsh.generateDeviceKey as jest.Mock).mockResolvedValue({
      publicKeyOpenSsh: 'ssh-ed25519 AAAA', fingerprintSha256: 'SHA256:device', keyHandle: 'handle-1',
    });
    (registerClientKey as jest.Mock).mockRejectedValue(new Error('unauthorized'));

    const { getByText, getByPlaceholderText } = renderScreen();
    fireEvent.changeText(getByPlaceholderText('instance-id'), 'inst1');
    fireEvent.press(getByText('Connect'));

    await waitFor(() => expect(getByText('unauthorized')).toBeTruthy());
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
