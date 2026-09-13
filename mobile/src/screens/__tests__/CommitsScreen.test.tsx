import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { CommitsScreen } from '../CommitsScreen';
import TreqSsh from '../../native/TreqSsh';

describe('CommitsScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('loads and renders commits on mount', async () => {
    (TreqSsh.execCommand as jest.Mock).mockResolvedValue({
      exitStatus: 0,
      stdout: JSON.stringify({
        commits: [
          {
            commit_id: 'abc123', short_id: 'abc', change_id: 'zzz', description: 'Add feature',
            author_name: 'Ada', timestamp: '2026-01-01T00:00:00Z', parent_ids: [], is_working_copy: true,
            bookmarks: [], is_immutable: false, insertions: 1, deletions: 0, has_conflicts: false,
          },
        ],
        target_branch: 'main',
        workspace_branch: 'feature-x',
      }),
      stderr: '',
    });

    const { getByText } = render(
      <CommitsScreen
        navigation={{} as any}
        route={{ key: 'commits', name: 'Commits', params: { sessionId: 's1', repo: '/repo', workspaceId: 1 } } as any}
      />,
    );

    await waitFor(() => expect(getByText('Add feature')).toBeTruthy());
    expect(getByText('abc')).toBeTruthy();
  });
});
