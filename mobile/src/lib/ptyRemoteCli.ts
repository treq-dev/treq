/**
 * Argv builders for the `pty-remote` CLI surface (mobile PRD Phase 7),
 * mirroring `src-tauri/src/core/remote.rs`'s `PtyStart`/`PtyList`/
 * `PtyStop`/`PtyAttachCommand` `cli_args()` shapes the same way
 * `treqCli.ts` mirrors the `agent-remote`/read-only shapes.
 *
 * This is a *separate* module from `treqCli.ts`, not an extension of it,
 * because `pty-remote attach` is not a JSON request/response call like
 * every function in `treqCli.ts` is: it is the literal command line an SSH
 * PTY channel execs (via `TreqSsh.openPty`), so its argv never round-trips
 * through `execCommand`/`parseCliJson` at all. Keeping it out of
 * `treqCli.ts` keeps that module's "every export is exec + parse JSON"
 * shape intact.
 *
 * `start`/`list`/`stop` *do* go through `execCommand` (they manage the
 * VM-local tmux/screen session's lifecycle, not the interactive channel
 * itself), so they follow the same `--format json` convention as
 * `treqCli.ts`'s functions and are parsed with `parseCliJson`.
 */

import { parseCliJson } from './treqCli';

export type PtyLaunchPayload = {
  remoteDir: string;
  command: string;
  cols: number;
  rows: number;
};

function launchPayloadJson(payload: PtyLaunchPayload): string {
  // Field names must match Rust's `PtyLaunchPayload` in
  // `src-tauri/src/core/remote.rs` (`remote_dir`/`command`/`cols`/`rows`) -
  // this is the same `--value` JSON-blob convention that function's
  // `pty_launch_payload` helper documents.
  return JSON.stringify({
    remote_dir: payload.remoteDir,
    command: payload.command,
    cols: payload.cols,
    rows: payload.rows,
  });
}

/** Starts (or reuses, if already running) a persistent PTY session. */
export function ptyStartArgv(
  repo: string,
  workspace: number,
  label: string,
  payload: PtyLaunchPayload,
  idempotencyKey: string,
): string[] {
  return [
    'pty-remote', 'start', '--repo', repo, '--workspace', String(workspace),
    '--target', label, '--value', launchPayloadJson(payload),
    '--idempotency-key', idempotencyKey, '--format', 'json',
  ];
}

/** Lists persistent PTY sessions, optionally scoped to `workspace`. */
export function ptyListArgv(repo: string, workspace?: number): string[] {
  const argv = ['pty-remote', 'list', '--repo', repo];
  if (workspace !== undefined) {
    argv.push('--workspace', String(workspace));
  }
  argv.push('--format', 'json');
  return argv;
}

/** Stops (kills) a persistent PTY session. Idempotent. */
export function ptyStopArgv(repo: string, workspace: number, label: string): string[] {
  return [
    'pty-remote', 'stop', '--repo', repo, '--workspace', String(workspace),
    '--target', label, '--format', 'json',
  ];
}

/**
 * Returns the literal command line an SSH PTY channel should exec to
 * attach (creating first if necessary) to a persistent session — this is
 * what a caller passes to `TreqSsh.openPty`'s `command` argument, not
 * something to `execCommand` itself.
 */
export function ptyAttachCommandArgv(
  repo: string,
  workspace: number,
  label: string,
  payload: PtyLaunchPayload,
): string[] {
  return [
    'pty-remote', 'attach-command', '--repo', repo, '--workspace', String(workspace),
    '--target', label, '--value', launchPayloadJson(payload), '--format', 'json',
  ];
}

export type PtySessionInfo = {
  sessionName: string;
  workspace: string;
  label: string;
  running: boolean;
};

/** Parses `pty-remote list`'s JSON stdout. */
export function parsePtySessions(stdout: string): PtySessionInfo[] {
  const raw = parseCliJson<
    Array<{ session_name: string; workspace: string; label: string; running: boolean }>
  >(stdout);
  return raw.map((item) => ({
    sessionName: item.session_name,
    workspace: item.workspace,
    label: item.label,
    running: item.running,
  }));
}

/** Parses `pty-remote attach-command`'s JSON stdout (a single string). */
export function parsePtyAttachCommand(stdout: string): string {
  return parseCliJson<string>(stdout);
}
