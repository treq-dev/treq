// Frontend entry point for Phase 5's typed remote command dispatch
// (`remote_dispatch_local` / `remote_dispatch_over_ssh` in
// `src-tauri/src/commands/remote_control.rs`). Every call sends a fully
// typed `TreqCommandRequest` variant - never a raw string - so the
// allow-list holds at the IPC boundary the same way it holds inside the
// exec transport.
//
// This is intentionally a separate, small surface from `src/lib/api.ts`
// rather than a rewrite of it: the existing ~50 local Tauri commands in
// `api.ts` are not yet mirrored one-to-one by `TreqCommandRequest` variants,
// so making every local data hook transport-aware is future work. What is
// wired here is the read-only review surface (status, changes, commits,
// conflicts) needed to replace the remote placeholder screen, plus the
// mutations the PRD calls "not yet supported" so the UI can disable them
// instead of sending a request that always fails.

import {
  remoteDispatchLocal,
  remoteDispatchMutationOverSsh,
  remoteDispatchOverSsh,
} from "./api-extra";
import type { SshEndpoint } from "./api-types-remote";

export type TreqCommandRequest =
  | { kind: "ProbeRepo"; repo: string }
  | {
      kind: "CloneRepo";
      repo_url: string;
      destination: string;
      idempotency_key?: string | null;
    }
  | {
      kind: "InitRepo";
      repo: string;
      idempotency_key?: string | null;
    }
  | { kind: "InspectRepository"; repo: string }
  | { kind: "RepositoryStatus"; repo: string }
  | { kind: "ListBranches"; repo: string }
  | { kind: "ListWorkspaces"; repo: string }
  | { kind: "InspectWorkspace"; repo: string; workspace: string }
  | { kind: "ListChanges"; repo: string; workspace?: string | null }
  | {
      kind: "DiffFile";
      repo: string;
      workspace?: string | null;
      path: string;
    }
  | {
      kind: "ReadFile";
      repo: string;
      workspace?: string | null;
      path: string;
      revision: "WorkingCopy" | "Parent";
      start_line?: number | null;
      end_line?: number | null;
    }
  | { kind: "ListCommits"; repo: string; workspace?: string | null }
  | { kind: "ListConflicts"; repo: string; workspace?: string | null }
  | {
      kind: "WorkspaceChangeMarker";
      repo: string;
      workspace?: string | null;
    }
  | { kind: "GitFetch"; repo: string; idempotency_key?: string | null }
  | {
      kind: "CreateCommit";
      repo: string;
      workspace?: string | null;
      message: string;
      idempotency_key?: string | null;
    }
  | {
      kind: "AgentStart";
      repo: string;
      workspace: string;
      agent: string;
      prompt: string;
      idempotency_key?: string | null;
    }
  | { kind: "AgentInput"; repo: string; workspace: string; input: string }
  | { kind: "AgentStatus"; repo: string; workspace: string }
  | { kind: "AgentStop"; repo: string; workspace: string }
  | { kind: "AgentLogs"; repo: string; workspace: string };

/**
 * Remote commands the PRD or Phase 5 explicitly marks `not_implemented` over
 * the exec channel. The UI must disable the corresponding action rather than
 * let a user trigger a request that always fails - see "Main application
 * integration": "disabling any action not yet supported remotely."
 */
export const REMOTE_NOT_IMPLEMENTED = new Set(["SplitCommit", "AgentInput"]);

export function isRemoteActionSupported(kind: string): boolean {
  return !REMOTE_NOT_IMPLEMENTED.has(kind);
}

export function dispatchLocal<T = unknown>(
  request: TreqCommandRequest,
): Promise<T> {
  return remoteDispatchLocal<T>(request);
}

export function dispatchOverSsh<T = unknown>(
  endpoint: SshEndpoint,
  request: TreqCommandRequest,
): Promise<T> {
  return remoteDispatchOverSsh<T>(endpoint, request);
}

/** Dispatches locally or over SSH depending on whether an endpoint is given. */
export function dispatch<T = unknown>(
  endpoint: SshEndpoint | null,
  request: TreqCommandRequest,
): Promise<T> {
  return endpoint
    ? dispatchOverSsh<T>(endpoint, request)
    : dispatchLocal<T>(request);
}

// -- Retrying after network loss (PRD "Structured command protocol" >
// "Retrying after network loss") --------------------------------------------
//
// A network failure while a mutating command is in flight does not tell the
// client whether the command reached the VM, ran, or completed. Mutating
// kinds must go through `dispatchMutationOverSsh`, never plain
// `dispatchOverSsh`, so the backend's verify-before-retry logic
// (`core::remote::retry_after_reconnect`) runs instead of the caller
// assuming the operation is safely idempotent and blindly resending it.

/** Mirrors `MutationDispatchResult` in `src-tauri/src/commands/remote_control.rs`. */
export type MutationDispatchResult<T = unknown> =
  | { status: "applied"; value: T }
  | { status: "already_applied" }
  | { status: "ambiguous"; reason: string };

/**
 * Runs a mutating `TreqCommandRequest` over SSH with verify-before-retry
 * semantics. Resolves to a `MutationDispatchResult` rather than a bare `T` so
 * a caller can render all three PRD outcomes distinctly:
 *
 * - `"applied"`: the mutation ran (first attempt, or a same-idempotency-key
 *   retry after a "not applied" verdict) - treat like a normal success.
 * - `"already_applied"`: a network failure interrupted the original attempt,
 *   but post-reconnect state showed it had already landed - nothing was
 *   resent, so this should refresh the UI the same way a fresh success would.
 * - `"ambiguous"`: a network failure interrupted the attempt and
 *   post-reconnect state could not confirm either way - the caller must ask
 *   the user rather than assume.
 */
export function dispatchMutationOverSsh<T = unknown>(
  endpoint: SshEndpoint,
  request: TreqCommandRequest,
): Promise<MutationDispatchResult<T>> {
  return remoteDispatchMutationOverSsh<MutationDispatchResult<T>>(
    endpoint,
    request,
  );
}

/**
 * Dispatches a mutation locally (verify-before-retry only applies to the
 * real SSH transport, where a network failure is possible) or over SSH with
 * verify-before-retry when an endpoint is given. Local mutations always
 * resolve as `"applied"` since there is no transport in between to fail.
 */
// eslint-disable-next-line local/no-unused-exported-ts-functions
export async function dispatchMutation<T = unknown>(
  endpoint: SshEndpoint | null,
  request: TreqCommandRequest,
): Promise<MutationDispatchResult<T>> {
  if (!endpoint) {
    const value = await dispatchLocal<T>(request);
    return { status: "applied", value };
  }
  return dispatchMutationOverSsh<T>(endpoint, request);
}
