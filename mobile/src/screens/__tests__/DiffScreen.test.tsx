import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { DiffScreen } from '../DiffScreen';
import TreqSsh from '../../native/TreqSsh';

describe('DiffScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('loads and renders diff hunks for the given path', async () => {
    (TreqSsh.execCommand as jest.Mock).mockResolvedValue({
      exitStatus: 0,
      stdout: JSON.stringify([
        { id: 'h1', header: '@@ -1,3 +1,4 @@', lines: ['+added'], patch: '+added\n' },
      ]),
      stderr: '',
    });

    const { getByText } = render(
      <DiffScreen
        navigation={{} as any}
        route={{
          key: 'diff',
          name: 'Diff',
          params: { sessionId: 's1', repo: '/repo', workspaceId: 1, path: 'src/lib.rs' },
        } as any}
      />,
    );

    await waitFor(() => expect(getByText('@@ -1,3 +1,4 @@')).toBeTruthy());
    expect(TreqSsh.execCommand).toHaveBeenCalledWith('s1', [
      'changes', 'diff', '--repo', '/repo', '--workspace', '1', '--path', 'src/lib.rs', '--format', 'json',
    ]);
  });
});
