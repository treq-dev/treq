import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { WorkspacesScreen } from '../WorkspacesScreen';
import TreqSsh from '../../native/TreqSsh';

const mockNavigate = jest.fn();

function renderScreen() {
  return render(
    <WorkspacesScreen
      navigation={{ navigate: mockNavigate } as any}
      route={{ key: 'workspaces', name: 'Workspaces', params: { sessionId: 'session-42' } } as any}
    />,
  );
}

describe('WorkspacesScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders the session id from route params', () => {
    const { getByText } = renderScreen();
    expect(getByText('Connected. Session: session-42')).toBeTruthy();
  });

  it('loads workspaces for a repo path and navigates to the selected one', async () => {
    (TreqSsh.execCommand as jest.Mock).mockResolvedValue({
      exitStatus: 0,
      stdout: JSON.stringify([
        { id: 7, workspace_name: 'feature-x', branch_name: 'feature-x', title: 'Feature X', target_branch: 'main', archived: false },
      ]),
      stderr: '',
    });

    const { getByText, getByPlaceholderText } = renderScreen();
    fireEvent.changeText(getByPlaceholderText('/home/treq/repos/my-project'), '/repo');
    fireEvent.press(getByText('Load workspaces'));

    await waitFor(() => expect(getByText('Feature X')).toBeTruthy());
    expect(TreqSsh.execCommand).toHaveBeenCalledWith('session-42', [
      'workspace', 'list', '--repo', '/repo', '--format', 'json',
    ]);

    fireEvent.press(getByText('Feature X'));
    expect(mockNavigate).toHaveBeenCalledWith('WorkspaceDetail', {
      sessionId: 'session-42',
      repo: '/repo',
      workspaceId: 7,
      workspaceName: 'feature-x',
    });
  });

  it('surfaces a workspace-list error', async () => {
    (TreqSsh.execCommand as jest.Mock).mockResolvedValue({ exitStatus: 1, stdout: '', stderr: 'no such repo' });

    const { getByText, getByPlaceholderText } = renderScreen();
    fireEvent.changeText(getByPlaceholderText('/home/treq/repos/my-project'), '/repo');
    fireEvent.press(getByText('Load workspaces'));

    await waitFor(() => expect(getByText('no such repo')).toBeTruthy());
  });
});
