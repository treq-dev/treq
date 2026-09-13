import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AgentScreen } from '../AgentScreen';
import TreqSsh from '../../native/TreqSsh';

function renderScreen() {
  return render(
    <AgentScreen
      navigation={{} as any}
      route={{
        key: 'agent',
        name: 'Agent',
        params: { sessionId: 'session-1', repo: '/repo', workspaceId: 3 },
      } as any}
    />,
  );
}

describe('AgentScreen', () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.useRealTimers());

  it('shows "not running" and starts an agent', async () => {
    (TreqSsh.execCommand as jest.Mock)
      .mockResolvedValueOnce({
        exitStatus: 0,
        stdout: JSON.stringify({ workspace: 'demo', running: false, agent: null, pid: null, started_at: null, should_refresh: false }),
        stderr: '',
      })
      .mockResolvedValueOnce({ exitStatus: 0, stdout: JSON.stringify({ workspace: 'demo', agent: 'claude', pid: 1 }), stderr: '' })
      .mockResolvedValueOnce({
        exitStatus: 0,
        stdout: JSON.stringify({ workspace: 'demo', running: true, agent: 'claude', pid: 1, started_at: 'now', should_refresh: false }),
        stderr: '',
      })
      .mockResolvedValueOnce({ exitStatus: 0, stdout: JSON.stringify('log output'), stderr: '' });

    const { getByText, getByPlaceholderText } = renderScreen();
    await waitFor(() => expect(getByText('not running')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('What should the agent do?'), 'fix the bug');
    fireEvent.press(getByText('Start agent'));

    await waitFor(() => expect(getByText(/running: claude/)).toBeTruthy());
    expect(TreqSsh.execCommand).toHaveBeenNthCalledWith(
      2,
      'session-1',
      expect.arrayContaining(['agent-remote', 'start', '--repo', '/repo', '--workspace', '3', '--target', 'claude', '--value', 'fix the bug']),
    );
  });

  it('sends input to a running agent', async () => {
    (TreqSsh.execCommand as jest.Mock)
      .mockResolvedValueOnce({
        exitStatus: 0,
        stdout: JSON.stringify({ workspace: 'demo', running: true, agent: 'claude', pid: 1, started_at: 'now', should_refresh: false }),
        stderr: '',
      })
      .mockResolvedValueOnce({ exitStatus: 0, stdout: JSON.stringify('log output'), stderr: '' })
      .mockResolvedValueOnce({ exitStatus: 0, stdout: JSON.stringify({}), stderr: '' })
      .mockResolvedValueOnce({
        exitStatus: 0,
        stdout: JSON.stringify({ workspace: 'demo', running: true, agent: 'claude', pid: 1, started_at: 'now', should_refresh: false }),
        stderr: '',
      })
      .mockResolvedValueOnce({ exitStatus: 0, stdout: JSON.stringify('log output\nmore'), stderr: '' });

    const { getByText, getByPlaceholderText } = renderScreen();
    await waitFor(() => expect(getByText(/running: claude/)).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('Reply to the agent'), 'go ahead');
    fireEvent.press(getByText('Send'));

    await waitFor(() =>
      expect(TreqSsh.execCommand).toHaveBeenCalledWith(
        'session-1',
        expect.arrayContaining(['agent-remote', 'input', '--repo', '/repo', '--workspace', '3', '--value', 'go ahead']),
      ),
    );
  });

  it('surfaces a status error', async () => {
    (TreqSsh.execCommand as jest.Mock).mockResolvedValue({ exitStatus: 1, stdout: '', stderr: 'boom' });

    const { getByText } = renderScreen();

    await waitFor(() => expect(getByText('boom')).toBeTruthy());
  });
});
