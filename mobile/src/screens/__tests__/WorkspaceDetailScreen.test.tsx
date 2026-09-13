import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { WorkspaceDetailScreen } from '../WorkspaceDetailScreen';
import TreqSsh from '../../native/TreqSsh';

const mockNavigate = jest.fn();

function renderScreen() {
  return render(
    <WorkspaceDetailScreen
      navigation={{ navigate: mockNavigate } as any}
      route={{
        key: 'workspace-detail',
        name: 'WorkspaceDetail',
        params: { sessionId: 'session-1', repo: '/repo', workspaceId: 3, workspaceName: 'feature-x' },
      } as any}
    />,
  );
}

describe('WorkspaceDetailScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('loads and renders changed files on mount', async () => {
    (TreqSsh.execCommand as jest.Mock).mockResolvedValue({
      exitStatus: 0,
      stdout: JSON.stringify([
        { path: 'src/lib.rs', status: 'modified', previous_path: null, changed_line_count: 4 },
      ]),
      stderr: '',
    });

    const { getByText } = renderScreen();

    await waitFor(() => expect(getByText('src/lib.rs')).toBeTruthy());
    expect(TreqSsh.execCommand).toHaveBeenCalledWith('session-1', [
      'changes', 'list', '--repo', '/repo', '--workspace', '3', '--format', 'json',
    ]);
  });

  it('surfaces a CLI error', async () => {
    (TreqSsh.execCommand as jest.Mock).mockResolvedValue({ exitStatus: 1, stdout: '', stderr: 'boom' });

    const { getByText } = renderScreen();

    await waitFor(() => expect(getByText('boom')).toBeTruthy());
  });
});
