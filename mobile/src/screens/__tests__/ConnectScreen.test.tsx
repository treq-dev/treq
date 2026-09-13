import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ConnectScreen } from '../ConnectScreen';
import TreqSsh from '../../native/TreqSsh';

const mockNavigate = jest.fn();

function renderScreen() {
  return render(
    <ConnectScreen
      navigation={{ navigate: mockNavigate } as any}
      route={{ key: 'connect', name: 'Connect' } as any}
    />,
  );
}

describe('ConnectScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('generates a device key and shows the public key', async () => {
    (TreqSsh.generateDeviceKey as jest.Mock).mockResolvedValue({
      publicKeyOpenSsh: 'ssh-ed25519 AAAA...',
      fingerprintSha256: 'SHA256:abc',
      keyHandle: 'handle-1',
    });

    const { getByText } = renderScreen();
    fireEvent.press(getByText('Generate device key'));

    await waitFor(() => expect(getByText('ssh-ed25519 AAAA...')).toBeTruthy());
    expect(TreqSsh.generateDeviceKey).toHaveBeenCalledTimes(1);
  });

  it('shows an error when connecting without a device key', async () => {
    const { getByText } = renderScreen();
    fireEvent.press(getByText('Connect'));

    await waitFor(() => expect(getByText('Generate a device key first.')).toBeTruthy());
    expect(TreqSsh.connect).not.toHaveBeenCalled();
  });

  it('connects and navigates to Workspaces on success', async () => {
    (TreqSsh.generateDeviceKey as jest.Mock).mockResolvedValue({
      publicKeyOpenSsh: 'ssh-ed25519 AAAA...',
      fingerprintSha256: 'SHA256:abc',
      keyHandle: 'handle-1',
    });
    (TreqSsh.connect as jest.Mock).mockResolvedValue('session-1');

    const { getByText, getByPlaceholderText } = renderScreen();
    fireEvent.press(getByText('Generate device key'));
    await waitFor(() => expect(getByText('ssh-ed25519 AAAA...')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('vm.example.com'), 'vm.example.com');
    fireEvent.changeText(getByPlaceholderText('treq'), 'treq');
    fireEvent.changeText(getByPlaceholderText('SHA256:...'), 'SHA256:xyz');

    fireEvent.press(getByText('Connect'));

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('Workspaces', { sessionId: 'session-1' }),
    );
    expect(TreqSsh.connect).toHaveBeenCalledWith(
      'vm.example.com',
      22,
      'treq',
      'handle-1',
      'SHA256:xyz',
    );
  });

  it('surfaces connection errors', async () => {
    (TreqSsh.generateDeviceKey as jest.Mock).mockResolvedValue({
      publicKeyOpenSsh: 'ssh-ed25519 AAAA...',
      fingerprintSha256: 'SHA256:abc',
      keyHandle: 'handle-1',
    });
    (TreqSsh.connect as jest.Mock).mockRejectedValue(new Error('host key mismatch'));

    const { getByText } = renderScreen();
    fireEvent.press(getByText('Generate device key'));
    await waitFor(() => expect(getByText('ssh-ed25519 AAAA...')).toBeTruthy());

    fireEvent.press(getByText('Connect'));

    await waitFor(() => expect(getByText('host key mismatch')).toBeTruthy());
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
