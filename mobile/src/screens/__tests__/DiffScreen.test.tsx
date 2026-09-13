import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { DiffScreen } from '../DiffScreen';
import TreqSsh from '../../native/TreqSsh';

describe('DiffScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  function renderScreen() {
    return render(
      <DiffScreen
        navigation={{} as any}
        route={{
          key: 'diff',
          name: 'Diff',
          params: { sessionId: 's1', repo: '/repo', workspaceId: 1, path: 'src/lib.rs' },
        } as any}
      />,
    );
  }

  it('loads and renders diff hunks for the given path', async () => {
    (TreqSsh.execCommand as jest.Mock).mockResolvedValue({
      exitStatus: 0,
      stdout: JSON.stringify([
        { id: 'h1', header: '@@ -1,3 +1,4 @@', lines: ['+added'], patch: '+added\n' },
      ]),
      stderr: '',
    });

    const { getByText } = renderScreen();

    await waitFor(() => expect(getByText('@@ -1,3 +1,4 @@')).toBeTruthy());
    expect(TreqSsh.execCommand).toHaveBeenCalledWith('s1', [
      'changes', 'diff', '--repo', '/repo', '--workspace', '1', '--path', 'src/lib.rs', '--format', 'json',
    ]);
  });

  it('renders conflict regions and a conflict banner when present', async () => {
    (TreqSsh.execCommand as jest.Mock).mockResolvedValue({
      exitStatus: 0,
      stdout: JSON.stringify([
        {
          id: 'h1', header: '@@ -1,3 +1,4 @@', lines: ['<<<<<<<'], patch: '<<<<<<<\n',
          conflict_regions: [{ id: 'c1', conflict_number: 1, total_conflicts: 1, content: '<<<<<<< left\n=======\nright\n>>>>>>>' }],
        },
      ]),
      stderr: '',
    });

    const { getByText } = renderScreen();

    await waitFor(() => expect(getByText('This file has unresolved conflicts.')).toBeTruthy());
    expect(getByText('Conflict 1 of 1')).toBeTruthy();
  });

  it('loads working-copy and parent file context on demand', async () => {
    (TreqSsh.execCommand as jest.Mock)
      .mockResolvedValueOnce({ exitStatus: 0, stdout: '[]', stderr: '' }) // diff
      .mockResolvedValueOnce({
        exitStatus: 0,
        stdout: JSON.stringify({ lines: ['line one'], start_line: 1, end_line: 1 }),
        stderr: '',
      });

    const { getByText } = renderScreen();
    await waitFor(() => expect(getByText('No hunks.')).toBeTruthy());

    fireEvent.press(getByText('Working copy'));

    await waitFor(() => expect(getByText('line one')).toBeTruthy());
    expect(TreqSsh.execCommand).toHaveBeenLastCalledWith('s1', [
      'file', 'read', '--repo', '/repo', '--workspace', '1',
      '--path', 'src/lib.rs', '--revision', 'working-copy', '--format', 'json',
    ]);
  });
});
