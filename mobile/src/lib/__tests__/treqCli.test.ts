import {
  diffFileArgv,
  listChangesArgv,
  listCommitsArgv,
  listConflictsArgv,
  listWorkspacesArgv,
  parseCliJson,
  parseCommits,
  parseConflicts,
  parseDiffHunks,
  parseFileChanges,
  parseFileLines,
  parseWorkspaces,
  readFileArgv,
} from '../treqCli';

describe('treqCli argv builders', () => {
  it('builds workspace list argv', () => {
    expect(listWorkspacesArgv('/repo')).toEqual(['workspace', 'list', '--repo', '/repo', '--format', 'json']);
  });

  it('builds changes list argv with an optional workspace id', () => {
    expect(listChangesArgv('/repo')).toEqual(['changes', 'list', '--repo', '/repo', '--format', 'json']);
    expect(listChangesArgv('/repo', 3)).toEqual([
      'changes', 'list', '--repo', '/repo', '--workspace', '3', '--format', 'json',
    ]);
  });

  it('builds diff argv with a path', () => {
    expect(diffFileArgv('/repo', 'src/main.rs', 3)).toEqual([
      'changes', 'diff', '--repo', '/repo', '--workspace', '3', '--path', 'src/main.rs', '--format', 'json',
    ]);
  });

  it('builds commits and conflicts list argv', () => {
    expect(listCommitsArgv('/repo', 1)).toEqual([
      'commits', 'list', '--repo', '/repo', '--workspace', '1', '--format', 'json',
    ]);
    expect(listConflictsArgv('/repo')).toEqual(['conflicts', 'list', '--repo', '/repo', '--format', 'json']);
  });

  it('builds file read argv for working-copy and parent revisions', () => {
    expect(readFileArgv('/repo', 'src/lib.rs', 'workingCopy', 3)).toEqual([
      'file', 'read', '--repo', '/repo', '--workspace', '3',
      '--path', 'src/lib.rs', '--revision', 'working-copy', '--format', 'json',
    ]);
    expect(readFileArgv('/repo', 'src/lib.rs', 'parent', 3, 10, 50)).toEqual([
      'file', 'read', '--repo', '/repo', '--workspace', '3',
      '--path', 'src/lib.rs', '--revision', 'parent',
      '--start-line', '10', '--end-line', '50', '--format', 'json',
    ]);
  });
});

describe('parseCliJson', () => {
  it('parses successful JSON', () => {
    expect(parseCliJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it('throws the CLI error message on a structured error response', () => {
    expect(() => parseCliJson('{"error":{"code":"workspace_not_found","message":"Workspace 42 was not found"}}'))
      .toThrow('Workspace 42 was not found');
  });

  it('throws on malformed JSON', () => {
    expect(() => parseCliJson('not json')).toThrow(/Could not parse/);
  });
});

describe('response parsers', () => {
  it('parses workspaces from snake_case CLI JSON', () => {
    const stdout = JSON.stringify([
      { id: 1, workspace_name: 'feature-x', branch_name: 'feature-x', title: 'Feature X', target_branch: 'main', archived: false },
    ]);
    expect(parseWorkspaces(stdout)).toEqual([
      { id: 1, workspaceName: 'feature-x', branchName: 'feature-x', title: 'Feature X', targetBranch: 'main', archived: false },
    ]);
  });

  it('parses file changes', () => {
    const stdout = JSON.stringify([
      { path: 'src/lib.rs', status: 'modified', previous_path: null, changed_line_count: 5, diff_deferred: false },
    ]);
    expect(parseFileChanges(stdout)).toEqual([
      { path: 'src/lib.rs', status: 'modified', previousPath: null, changedLineCount: 5 },
    ]);
  });

  it('parses diff hunks without conflict regions', () => {
    const stdout = JSON.stringify([
      { id: 'h1', header: '@@ -1,3 +1,4 @@', lines: ['+added'], patch: '+added\n' },
    ]);
    expect(parseDiffHunks(stdout)).toEqual([
      { id: 'h1', header: '@@ -1,3 +1,4 @@', lines: ['+added'], patch: '+added\n', conflictRegions: [] },
    ]);
  });

  it('parses diff hunks with conflict regions', () => {
    const stdout = JSON.stringify([
      {
        id: 'h1', header: '@@ -1,3 +1,4 @@', lines: ['<<<<<<<'], patch: '<<<<<<<\n',
        conflict_regions: [
          { id: 'c1', conflict_number: 1, total_conflicts: 1, content: '<<<<<<< left\n=======\nright\n>>>>>>>' },
        ],
      },
    ]);
    expect(parseDiffHunks(stdout)).toEqual([
      {
        id: 'h1', header: '@@ -1,3 +1,4 @@', lines: ['<<<<<<<'], patch: '<<<<<<<\n',
        conflictRegions: [
          { id: 'c1', conflictNumber: 1, totalConflicts: 1, content: '<<<<<<< left\n=======\nright\n>>>>>>>' },
        ],
      },
    ]);
  });

  it('parses file lines', () => {
    const stdout = JSON.stringify({ lines: ['a', 'b'], start_line: 1, end_line: 2 });
    expect(parseFileLines(stdout)).toEqual({ lines: ['a', 'b'], startLine: 1, endLine: 2 });
  });

  it('parses commits from a JjLogResult envelope', () => {
    const stdout = JSON.stringify({
      commits: [
        {
          commit_id: 'abc123', short_id: 'abc', change_id: 'zzz', description: 'Add feature',
          author_name: 'Ada', timestamp: '2026-01-01T00:00:00Z', parent_ids: [], is_working_copy: true,
          bookmarks: ['main'], is_immutable: false, insertions: 3, deletions: 1, has_conflicts: false,
        },
      ],
      target_branch: 'main',
      workspace_branch: 'feature-x',
    });
    expect(parseCommits(stdout)).toEqual([
      {
        commitId: 'abc123', shortId: 'abc', changeId: 'zzz', description: 'Add feature',
        authorName: 'Ada', timestamp: '2026-01-01T00:00:00Z', bookmarks: ['main'],
        isWorkingCopy: true, hasConflicts: false,
      },
    ]);
  });

  it('parses conflicts as a flat path list', () => {
    expect(parseConflicts(JSON.stringify(['src/a.rs', 'src/b.rs']))).toEqual(['src/a.rs', 'src/b.rs']);
  });
});
