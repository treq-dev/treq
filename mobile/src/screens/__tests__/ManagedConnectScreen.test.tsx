jest.mock('../../lib/controlPlane', () => ({
  ...jest.requireActual('../../lib/controlPlane'),
  getInstanceStatus: jest.fn(),
  listRegions: jest.fn(),
  listSizePresets: jest.fn(),
  ensureInstance: jest.fn(),
  wakeInstance: jest.fn(),
  registerClientKey: jest.fn(),
  issueCertificate: jest.fn(),
}));

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ManagedConnectScreen } from '../ManagedConnectScreen';
import TreqSsh from '../../native/TreqSsh';
import {
  ensureInstance,
  getInstanceStatus,
  issueCertificate,
  listRegions,
  listSizePresets,
  registerClientKey,
  wakeInstance,
} from '../../lib/controlPlane';

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
  beforeEach(() => {
    jest.clearAllMocks();
    (listRegions as jest.Mock).mockResolvedValue(['us_east', 'eu_west']);
    (listSizePresets as jest.Mock).mockResolvedValue(['small', 'medium']);
  });

  it('offers to provision a managed instance when none exists yet', async () => {
    (getInstanceStatus as jest.Mock).mockResolvedValue({ instance: null, endpoint: null });
    (ensureInstance as jest.Mock).mockResolvedValue({ operation_id: 'op1', status: 'pending' });

    const { getByText } = renderScreen();

    await waitFor(() => expect(getByText('No managed instance yet - choose a region and size')).toBeTruthy());
    fireEvent.press(getByText('us_east'));
    fireEvent.press(getByText('small'));
    fireEvent.press(getByText('Provision managed instance'));

    await waitFor(() => expect(ensureInstance).toHaveBeenCalledWith({
      region: 'us_east', size_preset: 'small', idempotency_key: expect.any(String),
    }));
  });

  it('offers to wake a suspended instance', async () => {
    (getInstanceStatus as jest.Mock).mockResolvedValue({
      instance: { instance_id: 'inst1', status: 'suspended' }, endpoint: null,
    });

    const { getByText } = renderScreen();
    await waitFor(() => expect(getByText('Instance status: suspended')).toBeTruthy());

    fireEvent.press(getByText('Wake instance'));
    await waitFor(() => expect(wakeInstance).toHaveBeenCalledWith({
      instance_id: 'inst1', idempotency_key: expect.any(String),
    }));
  });

  it('connects to a ready instance', async () => {
    (getInstanceStatus as jest.Mock).mockResolvedValue({
      instance: { instance_id: 'inst1', status: 'ready' }, endpoint: null,
    });
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

    const { getByText } = renderScreen();
    await waitFor(() => expect(getByText('Instance status: ready')).toBeTruthy());

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
    (getInstanceStatus as jest.Mock).mockRejectedValue(new Error('unauthorized'));

    const { getByText } = renderScreen();
    await waitFor(() => expect(getByText('unauthorized')).toBeTruthy());
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
