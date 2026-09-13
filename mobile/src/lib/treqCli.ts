/**
 * Mirrors the desktop `TreqCommandRequest` CLI argv/response contract
 * (`src-tauri/src/core/remote.rs`'s `cli_args()`, `src-tauri/src/jj.rs`,
 * `src-tauri/src/local_db.rs`) for the read-only variants Phase 3 of
 * prds/mobile.md covers: ListWorkspaces, ListChanges, DiffFile,
 * ListCommits, ListConflicts. Mobile has no Tauri IPC to dispatch
 * `TreqCommandRequest` through, so it runs the same `treq <command>
 * <action> --repo <repo> [--workspace <id>] [--path <path>] --format json`
 * CLI invocations directly over its own SSH exec channel
 * (`TreqSsh.execCommand`) and parses the same JSON response shapes.
 *
 * As prds/mobile.md's Phase 3 section notes, this is convergence with the
 * desktop response shapes, not a contract enforced by either side - a
 * future change to either could silently drift. These types are
 * hand-mirrored from the Rust structs above, not generated.
 */

export type Workspace = {
  id: number;
  workspaceName: string;
  branchName: string;
  title: string;
  targetBranch: string | null;
  archived: boolean;
};

export type FileChange = {
  path: string;
  status: string;
  previousPath: string | null;
  changedLineCount: number;
};

/**
 * Simplified mirror of a single `ConflictRegionView` (`conflict_markers.rs`)
 * - only enough to show a reader "this hunk has an unresolved conflict"
 * and its raw marker text, not the full structural line/comparison detail
 * desktop's conflict editor uses. `prds/mobile.md`'s Phase 3 section notes
 * this is a simplification, not a parity claim.
 */
export type ConflictRegion = {
  id: string;
  conflictNumber: number;
  totalConflicts: number;
  content: string;
};

export type DiffHunk = {
  id: string;
  header: string;
  lines: string[];
  patch: string;
  conflictRegions: ConflictRegion[];
};

export type FileRevision = 'workingCopy' | 'parent';

export type FileLines = {
  lines: string[];
  startLine: number;
  endLine: number;
};

export type Commit = {
  commitId: string;
  shortId: string;
  changeId: string;
  description: string;
  authorName: string;
  timestamp: string;
  bookmarks: string[];
  isWorkingCopy: boolean;
  hasConflicts: boolean;
};

/**
 * Mirrors `AgentStatusResult` (`core::agent_supervisor`) as returned by
 * `agent-remote status`/`stop` - see `crates/treq-mobile-ssh`'s architecture
 * note in `treqCli.ts`'s module doc: mobile drives the same VM-local
 * supervisor over its own SSH exec channel rather than desktop's Tauri IPC.
 */
export type AgentStatus = {
  workspace: string;
  running: boolean;
  agent: string | null;
  pid: number | null;
  startedAt: string | null;
  shouldRefresh: boolean;
};

function baseArgv(command: string, action: string, repo: string, workspaceId?: number): string[] {
  const argv = [command, action, '--repo', repo];
  if (workspaceId !== undefined) {
    argv.push('--workspace', String(workspaceId));
  }
  return argv;
}

export function listWorkspacesArgv(repo: string): string[] {
  return [...baseArgv('workspace', 'list', repo), '--format', 'json'];
}

export function listChangesArgv(repo: string, workspaceId?: number): string[] {
  return [...baseArgv('changes', 'list', repo, workspaceId), '--format', 'json'];
}

export function diffFileArgv(repo: string, path: string, workspaceId?: number): string[] {
  return [...baseArgv('changes', 'diff', repo, workspaceId), '--path', path, '--format', 'json'];
}

export function listCommitsArgv(repo: string, workspaceId?: number): string[] {
  return [...baseArgv('commits', 'list', repo, workspaceId), '--format', 'json'];
}

export function listConflictsArgv(repo: string, workspaceId?: number): string[] {
  return [...baseArgv('conflicts', 'list', repo, workspaceId), '--format', 'json'];
}

// --- Phase 4: agent control (`agent-remote <action>`) ---

export function agentStartArgv(
  repo: string,
  workspace: number,
  agent: string,
  prompt: string,
  idempotencyKey: string,
): string[] {
  return [
    'agent-remote', 'start', '--repo', repo, '--workspace', String(workspace),
    '--target', agent, '--value', prompt, '--idempotency-key', idempotencyKey,
    '--format', 'json',
  ];
}

export function agentInputArgv(
  repo: string,
  workspace: number,
  input: string,
  idempotencyKey: string,
): string[] {
  return [
    'agent-remote', 'input', '--repo', repo, '--workspace', String(workspace),
    '--value', input, '--idempotency-key', idempotencyKey, '--format', 'json',
  ];
}

export function agentStatusArgv(repo: string, workspace: number): string[] {
  return ['agent-remote', 'status', '--repo', repo, '--workspace', String(workspace), '--format', 'json'];
}

export function agentStopArgv(repo: string, workspace: number): string[] {
  return ['agent-remote', 'stop', '--repo', repo, '--workspace', String(workspace), '--format', 'json'];
}

export function agentLogsArgv(repo: string, workspace: number): string[] {
  return ['agent-remote', 'logs', '--repo', repo, '--workspace', String(workspace), '--format', 'json'];
}

export function parseAgentStatus(stdout: string): AgentStatus {
  type RawAgentStatus = {
    workspace: string;
    running: boolean;
    agent: string | null;
    pid: number | null;
    started_at: string | null;
    should_refresh: boolean;
  };
  const raw = parseCliJson<RawAgentStatus>(stdout);
  return {
    workspace: raw.workspace,
    running: raw.running,
    agent: raw.agent,
    pid: raw.pid,
    startedAt: raw.started_at,
    shouldRefresh: raw.should_refresh,
  };
}

/** `agent-remote logs` returns the log tail as a bare JSON string. */
export function parseAgentLogs(stdout: string): string {
  return parseCliJson<string>(stdout);
}

// --- Phase 5: controlled mutations ---
// Each mutation carries a caller-supplied idempotency key (see
// `generateIdempotencyKey` in `controlPlane.ts`) so a retry after a dropped
// connection replays the original result instead of double-applying, per
// `core::remote`'s `with_idempotency_key` on the desktop/CLI side.

export function createWorkspaceArgv(repo: string, branchName: string, idempotencyKey: string, sourceBranch?: string): string[] {
  const argv = ['workspace', 'create', '--repo', repo, '--value', branchName, '--idempotency-key', idempotencyKey];
  if (sourceBranch) {
    argv.push('--target', sourceBranch);
  }
  argv.push('--format', 'json');
  return argv;
}

export function rebaseWorkspaceArgv(repo: string, workspace: number, targetBranch: string, idempotencyKey: string): string[] {
  return [
    'workspace', 'rebase', '--repo', repo, '--workspace', String(workspace),
    '--target', targetBranch, '--idempotency-key', idempotencyKey, '--format', 'json',
  ];
}

export function patchFileArgv(
  repo: string,
  path: string,
  patchBase64: string,
  idempotencyKey: string,
  workspace?: number,
): string[] {
  return [
    ...baseArgv('file', 'patch', repo, workspace),
    '--path', path, '--value', patchBase64, '--idempotency-key', idempotencyKey, '--format', 'json',
  ];
}

export function createCommitArgv(repo: string, message: string, idempotencyKey: string, workspace?: number): string[] {
  return [
    ...baseArgv('commits', 'create', repo, workspace),
    '--value', message, '--idempotency-key', idempotencyKey, '--format', 'json',
  ];
}

/** `sides` are jj resolve-side tokens (e.g. `left`, `right`, `base`); omit for the CLI's default resolution. */
export function resolveConflictArgv(repo: string, revision: string, idempotencyKey: string, sides: string[] = []): string[] {
  const argv = ['conflicts', 'resolve', '--repo', repo, '--target', revision, '--idempotency-key', idempotencyKey];
  if (sides.length > 0) {
    argv.push('--value', sides.join(','));
  }
  argv.push('--format', 'json');
  return argv;
}

export function gitPushArgv(repo: string, idempotencyKey: string, workspace?: number): string[] {
  return [...baseArgv('git', 'push', repo, workspace), '--idempotency-key', idempotencyKey, '--format', 'json'];
}

export function readFileArgv(
  repo: string,
  path: string,
  revision: FileRevision,
  workspaceId?: number,
  startLine?: number,
  endLine?: number,
): string[] {
  const argv = [
    ...baseArgv('file', 'read', repo, workspaceId),
    '--path', path,
    '--revision', revision === 'workingCopy' ? 'working-copy' : 'parent',
  ];
  if (startLine !== undefined) {
    argv.push('--start-line', String(startLine));
  }
  if (endLine !== undefined) {
    argv.push('--end-line', String(endLine));
  }
  argv.push('--format', 'json');
  return argv;
}

/**
 * Every CLI invocation's stdout is either the bare result JSON, or
 * `{"error": {"code": ..., "message": ...}}` on failure (see
 * remote_ssh_transport.rs's module docs) - this throws a plain `Error`
 * carrying that message so screens can render one consistent error path.
 */
export function parseCliJson<T>(stdout: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`Could not parse CLI response as JSON: ${stdout}`);
  }
  if (parsed && typeof parsed === 'object' && 'error' in (parsed as Record<string, unknown>)) {
    const err = (parsed as { error: { code?: string; message?: string } }).error;
    throw new Error(err.message ?? err.code ?? 'Unknown CLI error');
  }
  return parsed as T;
}

export function parseWorkspaces(stdout: string): Workspace[] {
  type RawWorkspace = {
    id: number;
    workspace_name: string;
    branch_name: string;
    title: string;
    target_branch: string | null;
    archived: boolean;
  };
  return parseCliJson<RawWorkspace[]>(stdout).map((w) => ({
    id: w.id,
    workspaceName: w.workspace_name,
    branchName: w.branch_name,
    title: w.title,
    targetBranch: w.target_branch,
    archived: w.archived,
  }));
}

export function parseFileChanges(stdout: string): FileChange[] {
  type RawFileChange = {
    path: string;
    status: string;
    previous_path: string | null;
    changed_line_count: number;
  };
  return parseCliJson<RawFileChange[]>(stdout).map((f) => ({
    path: f.path,
    status: f.status,
    previousPath: f.previous_path,
    changedLineCount: f.changed_line_count,
  }));
}

export function parseDiffHunks(stdout: string): DiffHunk[] {
  type RawConflictRegion = {
    id: string;
    conflict_number: number;
    total_conflicts: number;
    content: string;
  };
  type RawHunk = {
    id: string;
    header: string;
    lines: string[];
    patch: string;
    conflict_regions?: RawConflictRegion[];
  };
  return parseCliJson<RawHunk[]>(stdout).map((h) => ({
    id: h.id,
    header: h.header,
    lines: h.lines,
    patch: h.patch,
    conflictRegions: (h.conflict_regions ?? []).map((r) => ({
      id: r.id,
      conflictNumber: r.conflict_number,
      totalConflicts: r.total_conflicts,
      content: r.content,
    })),
  }));
}

export function parseCommits(stdout: string): Commit[] {
  type RawLogResult = {
    commits: Array<{
      commit_id: string;
      short_id: string;
      change_id: string;
      description: string;
      author_name: string;
      timestamp: string;
      bookmarks: string[];
      is_working_copy: boolean;
      has_conflicts: boolean;
    }>;
  };
  const result = parseCliJson<RawLogResult>(stdout);
  return result.commits.map((c) => ({
    commitId: c.commit_id,
    shortId: c.short_id,
    changeId: c.change_id,
    description: c.description,
    authorName: c.author_name,
    timestamp: c.timestamp,
    bookmarks: c.bookmarks,
    isWorkingCopy: c.is_working_copy,
    hasConflicts: c.has_conflicts,
  }));
}

export function parseConflicts(stdout: string): string[] {
  return parseCliJson<string[]>(stdout);
}

export function parseFileLines(stdout: string): FileLines {
  type RawFileLines = { lines: string[]; start_line: number; end_line: number };
  const raw = parseCliJson<RawFileLines>(stdout);
  return { lines: raw.lines, startLine: raw.start_line, endLine: raw.end_line };
}
