// UI-driven, unmocked end-to-end test: types into the real ConnectScreen
// and WorkspacesScreen with @testing-library/react-native (never
// fireEvent's lower-level API directly - render/fireEvent here still goes
// through real component event handlers), against the *real* compiled
// treq-mobile-ssh Rust library (via TreqSsh.real.ts - see
// jest.config.real.js) and a real SSH server process (mock_ssh_server).
//
// Requires `npm run build:native-test` to have produced
// native-test/treq_mobile_ssh.node and native-test/mock_ssh_server first.
// Run with `npm run test:real`.

import React from 'react';
import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ConnectScreen } from '../ConnectScreen';
import { WorkspacesScreen } from '../WorkspacesScreen';

type ServerInfo = { host: string; port: number; fingerprintSha256: string };

function startMockSshServer(): Promise<{ info: ServerInfo; child: ChildProcessWithoutNullStreams }> {
  return new Promise((resolve, reject) => {
    const binaryPath = path.join(__dirname, '../../../native-test/mock_ssh_server');
    const child = spawn(binaryPath, ['127.0.0.1:0']);
    let buffered = '';

    const onData = (chunk: Buffer) => {
      buffered += chunk.toString();
      const match = /LISTENING (\S+) (\d+) (\S+)/.exec(buffered);
      if (match) {
        child.stdout.off('data', onData);
        resolve({
          info: { host: match[1], port: Number(match[2]), fingerprintSha256: match[3] },
          child,
        });
      }
    };
    child.stdout.on('data', onData);
    child.on('error', reject);
  });
}

describe('SSH connection (real Rust, no mocks)', () => {
  let server: { info: ServerInfo; child: ChildProcessWithoutNullStreams };

  beforeAll(async () => {
    server = await startMockSshServer();
  }, 15_000);

  afterAll(() => {
    server.child.kill();
  });

  it('connects via a pasted connection string and runs a real command over SSH', async () => {
    let navigatedSessionId: string | null = null;
    const navigation = {
      navigate: (_screen: string, params: { sessionId: string }) => {
        navigatedSessionId = params.sessionId;
      },
    };

    const { getByText, getByPlaceholderText } = render(
      <ConnectScreen navigation={navigation as any} route={{ key: 'connect', name: 'Connect' } as any} />,
    );

    const connectionString = `treq@${server.info.host}:${server.info.port}#${server.info.fingerprintSha256}`;
    fireEvent.changeText(
      getByPlaceholderText('treq@127.0.0.1:2222#SHA256:abc123'),
      connectionString,
    );
    fireEvent.press(getByText('Parse connection string'));

    fireEvent.press(getByText('Generate device key'));
    await waitFor(() => expect(getByText(/ssh-ed25519/)).toBeTruthy(), { timeout: 10_000 });

    fireEvent.press(getByText('Connect'));
    await waitFor(() => expect(navigatedSessionId).not.toBeNull(), { timeout: 10_000 });

    const sessionId = navigatedSessionId as unknown as string;

    const { getByText: getByTextWs, getByPlaceholderText: getByPlaceholderTextWs } = render(
      <WorkspacesScreen
        navigation={{} as any}
        route={{ key: 'workspaces', name: 'Workspaces', params: { sessionId } } as any}
      />,
    );

    fireEvent.changeText(getByPlaceholderTextWs('treq workspace list'), 'treq workspace list --format=json');
    fireEvent.press(getByTextWs('Run'));

    await waitFor(
      () => expect(getByTextWs(/'treq' 'workspace' 'list' '--format=json'/)).toBeTruthy(),
      { timeout: 10_000 },
    );
    expect(getByTextWs('Exit status: 0')).toBeTruthy();
  }, 20_000);
});
