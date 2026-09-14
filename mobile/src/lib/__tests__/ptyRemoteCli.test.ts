import {
  parsePtyAttachCommand,
  parsePtySessions,
  ptyAttachCommandArgv,
  ptyListArgv,
  ptyStartArgv,
  ptyStopArgv,
} from '../ptyRemoteCli';

const payload = { remoteDir: '/srv/project', command: 'bash', cols: 80, rows: 24 };

describe('ptyRemoteCli argv builders', () => {
  it('builds pty-remote start argv with a JSON launch payload', () => {
    const argv = ptyStartArgv('/repo', 3, 'term', payload, 'idem-1');
    expect(argv.slice(0, 6)).toEqual(['pty-remote', 'start', '--repo', '/repo', '--workspace', '3']);
    expect(argv).toContain('--target');
    expect(argv[argv.indexOf('--target') + 1]).toBe('term');
    const value = argv[argv.indexOf('--value') + 1];
    expect(JSON.parse(value)).toEqual({
      remote_dir: '/srv/project',
      command: 'bash',
      cols: 80,
      rows: 24,
    });
    expect(argv).toEqual(expect.arrayContaining(['--idempotency-key', 'idem-1', '--format', 'json']));
  });

  it('builds pty-remote list argv with an optional workspace scope', () => {
    expect(ptyListArgv('/repo')).toEqual(['pty-remote', 'list', '--repo', '/repo', '--format', 'json']);
    expect(ptyListArgv('/repo', 3)).toEqual([
      'pty-remote', 'list', '--repo', '/repo', '--workspace', '3', '--format', 'json',
    ]);
  });

  it('builds pty-remote stop argv', () => {
    expect(ptyStopArgv('/repo', 3, 'term')).toEqual([
      'pty-remote', 'stop', '--repo', '/repo', '--workspace', '3', '--target', 'term', '--format', 'json',
    ]);
  });

  it('builds pty-remote attach-command argv carrying the same launch payload shape', () => {
    const argv = ptyAttachCommandArgv('/repo', 3, 'term', payload);
    expect(argv[0]).toBe('pty-remote');
    expect(argv[1]).toBe('attach-command');
    const value = argv[argv.indexOf('--value') + 1];
    expect(JSON.parse(value).remote_dir).toBe('/srv/project');
  });

  it('parses a pty-remote list response', () => {
    const stdout = JSON.stringify([
      { session_name: 'treq-pty-1-term', workspace: '1', label: 'term', running: true },
    ]);
    expect(parsePtySessions(stdout)).toEqual([
      { sessionName: 'treq-pty-1-term', workspace: '1', label: 'term', running: true },
    ]);
  });

  it('parses a pty-remote attach-command response', () => {
    const stdout = JSON.stringify('cd /srv/project && exec tmux new-session -A -s treq-pty-1-term');
    expect(parsePtyAttachCommand(stdout)).toBe(
      'cd /srv/project && exec tmux new-session -A -s treq-pty-1-term',
    );
  });

  it('surfaces a structured CLI error the same way treqCli.parseCliJson does', () => {
    const stdout = JSON.stringify({ error: { code: 'dependency_error', message: 'tmux is not installed' } });
    expect(() => parsePtySessions(stdout)).toThrow('tmux is not installed');
  });
});
