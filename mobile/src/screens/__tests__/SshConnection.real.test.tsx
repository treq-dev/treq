// UI-driven, unmocked end-to-end test: types into the real ConnectScreen,
// WorkspacesScreen, WorkspaceDetailScreen, DiffScreen, CommitsScreen and
// ConflictsScreen with @testing-library/react-native (render/fireEvent -
// never the lower-level DOM APIs directly), against the *real* compiled
// treq-mobile-ssh Rust library (via TreqSsh.real.ts - see
// jest.config.real.js) and a real SSH server process (mock_ssh_server)
// that returns Phase 3 CLI fixture JSON (see
// crates/treq-mobile-ssh/src/lib.rs's `mock_server::fixture_response`).
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
import { WorkspaceDetailScreen } from '../WorkspaceDetailScreen';
import { DiffScreen } from '../DiffScreen';
import { CommitsScreen } from '../CommitsScreen';
import { ConflictsScreen } from '../ConflictsScreen';

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

/** Drives ConnectScreen through key generation and connect, returning the
 * real session id TreqSsh.connect assigned. */
async function connectViaUi(server: ServerInfo): Promise<string> {
  let navigatedSessionId: string | null = null;
  const navigation = {
    navigate: (_screen: string, params: { sessionId: string }) => {
      navigatedSessionId = params.sessionId;
    },
  };

  const { getByText, getByPlaceholderText } = render(
    <ConnectScreen navigation={navigation as any} route={{ key: 'connect', name: 'Connect' } as any} />,
  );

  const connectionString = `treq@${server.host}:${server.port}#${server.fingerprintSha256}`;
  fireEvent.changeText(getByPlaceholderText('treq@127.0.0.1:2222#SHA256:abc123'), connectionString);
  fireEvent.press(getByText('Parse connection string'));

  fireEvent.press(getByText('Generate device key'));
  await waitFor(() => expect(getByText(/ssh-ed25519/)).toBeTruthy(), { timeout: 10_000 });

  fireEvent.press(getByText('Connect'));
  await waitFor(() => expect(navigatedSessionId).not.toBeNull(), { timeout: 10_000 });

  return navigatedSessionId as unknown as string;
}

describe('SSH connection and Phase 3 review screens (real Rust, no mocks)', () => {
  let server: { info: ServerInfo; child: ChildProcessWithoutNullStreams };

  beforeAll(async () => {
    server = await startMockSshServer();
  }, 15_000);

  afterAll(() => {
    server.child.kill();
  });

  it('connects via a pasted connection string and runs a raw command over SSH', async () => {
    const sessionId = await connectViaUi(server.info);

    const { getByText, getByPlaceholderText } = render(
      <WorkspacesScreen
        navigation={{} as any}
        route={{ key: 'workspaces', name: 'Workspaces', params: { sessionId } } as any}
      />,
    );

    fireEvent.changeText(getByPlaceholderText('treq workspace list'), 'treq workspace list --format=json');
    fireEvent.press(getByText('Run'));

    await waitFor(
      () => expect(getByText(/'treq' 'workspace' 'list' '--format=json'/)).toBeTruthy(),
      { timeout: 10_000 },
    );
    expect(getByText('Exit status: 0')).toBeTruthy();
  }, 20_000);

  it('loads real workspaces, changes, a diff, commits, and conflicts through the actual screens', async () => {
    const sessionId = await connectViaUi(server.info);

    // WorkspacesScreen: load and select a workspace
    const workspaces = render(
      <WorkspacesScreen
        navigation={{ navigate: () => {} } as any}
        route={{ key: 'workspaces', name: 'Workspaces', params: { sessionId } } as any}
      />,
    );
    fireEvent.changeText(workspaces.getByPlaceholderText('/home/treq/repos/my-project'), '/repo');
    fireEvent.press(workspaces.getByText('Load workspaces'));
    await waitFor(() => expect(workspaces.getByText('Feature X')).toBeTruthy(), { timeout: 10_000 });

    // WorkspaceDetailScreen: real changed-file list from the mock server
    const detail = render(
      <WorkspaceDetailScreen
        navigation={{} as any}
        route={{
          key: 'workspace-detail',
          name: 'WorkspaceDetail',
          params: { sessionId, repo: '/repo', workspaceId: 7, workspaceName: 'feature-x' },
        } as any}
      />,
    );
    await waitFor(() => expect(detail.getByText('src/lib.rs')).toBeTruthy(), { timeout: 10_000 });

    // DiffScreen: real diff hunk for that file
    const diff = render(
      <DiffScreen
        navigation={{} as any}
        route={{
          key: 'diff', name: 'Diff',
          params: { sessionId, repo: '/repo', workspaceId: 7, path: 'src/lib.rs' },
        } as any}
      />,
    );
    await waitFor(() => expect(diff.getByText('@@ -1,3 +1,4 @@')).toBeTruthy(), { timeout: 10_000 });

    // CommitsScreen: real commit list
    const commits = render(
      <CommitsScreen
        navigation={{} as any}
        route={{ key: 'commits', name: 'Commits', params: { sessionId, repo: '/repo', workspaceId: 7 } } as any}
      />,
    );
    await waitFor(() => expect(commits.getByText('Add feature')).toBeTruthy(), { timeout: 10_000 });

    // ConflictsScreen: real conflicted-path list
    const conflicts = render(
      <ConflictsScreen
        navigation={{} as any}
        route={{ key: 'conflicts', name: 'Conflicts', params: { sessionId, repo: '/repo', workspaceId: 7 } } as any}
      />,
    );
    await waitFor(() => expect(conflicts.getByText('src/a.rs')).toBeTruthy(), { timeout: 10_000 });
  }, 30_000);
});
