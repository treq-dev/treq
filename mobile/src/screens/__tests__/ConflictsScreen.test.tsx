import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { ConflictsScreen } from '../ConflictsScreen';
import TreqSsh from '../../native/TreqSsh';

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
