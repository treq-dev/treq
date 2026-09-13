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

export type DiffHunk = {
  id: string;
  header: string;
  lines: string[];
  patch: string;
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
  type RawHunk = { id: string; header: string; lines: string[]; patch: string };
  return parseCliJson<RawHunk[]>(stdout).map((h) => ({
    id: h.id,
    header: h.header,
    lines: h.lines,
    patch: h.patch,
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
