import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ConflictsScreen } from '../ConflictsScreen';
import TreqSsh from '../../native/TreqSsh';

const mockNavigate = jest.fn();

describe('ConflictsScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('loads and renders conflicted file paths', async () => {
    (TreqSsh.execCommand as jest.Mock).mockResolvedValue({
      exitStatus: 0,
      stdout: JSON.stringify(['src/a.rs', 'src/b.rs']),
      stderr: '',
    });

    const { getByText } = render(
      <ConflictsScreen
        navigation={{} as any}
        route={{ key: 'conflicts', name: 'Conflicts', params: { sessionId: 's1', repo: '/repo', workspaceId: 1 } } as any}
      />,
    );

    await waitFor(() => expect(getByText('src/a.rs')).toBeTruthy());
    expect(getByText('src/b.rs')).toBeTruthy();
  });

  it('navigates to Diff for the tapped conflicted path', async () => {
    (TreqSsh.execCommand as jest.Mock).mockResolvedValue({
      exitStatus: 0,
      stdout: JSON.stringify(['src/a.rs']),
      stderr: '',
    });

    const { getByText } = render(
      <ConflictsScreen
        navigation={{ navigate: mockNavigate } as any}
        route={{ key: 'conflicts', name: 'Conflicts', params: { sessionId: 's1', repo: '/repo', workspaceId: 1 } } as any}
      />,
    );

    await waitFor(() => expect(getByText('src/a.rs')).toBeTruthy());
    fireEvent.press(getByText('src/a.rs'));

    expect(mockNavigate).toHaveBeenCalledWith('Diff', {
      sessionId: 's1', repo: '/repo', workspaceId: 1, path: 'src/a.rs',
    });
  });

  it('renders an empty state', async () => {
    (TreqSsh.execCommand as jest.Mock).mockResolvedValue({ exitStatus: 0, stdout: '[]', stderr: '' });

    const { getByText } = render(
      <ConflictsScreen
        navigation={{} as any}
        route={{ key: 'conflicts', name: 'Conflicts', params: { sessionId: 's1', repo: '/repo', workspaceId: 1 } } as any}
      />,
    );

    await waitFor(() => expect(getByText('No conflicts.')).toBeTruthy());
  });
});
