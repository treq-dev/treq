# Mobile Remote Control

## Status

Superseded. Earlier revisions of this PRD extended the existing Tauri desktop build to Android/iOS targets, sharing `src-tauri` directly. That path (Tauri mobile build targets, `MobileShell`, `RemoteConnectPanel`, and the `#[cfg(mobile)]` device-key/keystore/biometric code in `core::remote_device_key`) has been removed. Mobile is now a separate React Native application under `mobile/`, calling into a dedicated Rust SSH crate (`crates/treq-mobile-ssh`) through a native module bridge (UniFFI-generated Swift/Kotlin bindings), rather than compiling the Tauri app itself for mobile. This document is retained for the product requirements it still describes (key custody, host trust, phased review/agent-control rollout); architecture sections below describing the Tauri-mobile approach are historical and being revised.

## Summary

Treq mobile is a standalone React Native application (`mobile/`) rather than the Tauri desktop app compiled for mobile targets. It talks to the same control-plane APIs and, over SSH, the same allow-listed Treq CLI commands that the desktop app uses, but through its own Rust SSH crate (`crates/treq-mobile-ssh`, built on `russh`) exposed to the RN JS layer via a native module bridge, instead of reusing `src-tauri`'s Tauri IPC surface directly.

Remote review of VM-hosted repositories over SSH (see [Remote SSH Control](./remote-ssh.md)) remains a separate, larger capability that mobile will consume once it lands, but it is not a precondition for shipping a mobile build: a mobile build can review and operate on repositories reachable the same way the desktop app reaches them today.

## Dependencies

Phase 1 (this PRD) only requires:

- Android and iOS build tooling for the existing Tauri app (Android SDK/NDK, Xcode, `tauri android init` / `tauri ios init`).
- A mobile-scoped Tauri capability set (`src-tauri/capabilities/mobile.json`) distinct from the desktop capability set (no multi-window, no CLI plugin).
- A mobile-specific top-level layout in the React app.

Later phases that add remote-VM review and control depend on the requirements in [Remote SSH Control](./remote-ssh.md) being stable:

- provider-neutral endpoint and repository identities;
- strict host-key verification;
- user-owned private keys and independently revocable public-key records;
- short-lived SSH certificates for Treq-managed VMs;
- allow-listed Treq CLI requests and stable JSON errors;
- complete remote review APIs;
- remote mutations with idempotency;
- durable agent lifecycle commands where required;
- observable, bounded SSH operations.

## Goals

- Build and ship Treq for Android and iOS from the existing Tauri codebase, no fork.
- Detect a mobile viewport/platform and render `MobileShell` instead of the desktop `Dashboard`.
- Expose the same Tauri commands (`lib/api.ts`) to the mobile layout that the desktop layout uses.
- Scope mobile permissions with a dedicated Tauri capability file, dropping desktop-only capabilities (multi-window, CLI plugin) that don't apply on mobile.
- Once Remote SSH Control is stable, connect to an explicitly configured endpoint using a native mobile SSH library, keep private keys in platform-protected device storage, verify pinned server host keys, and use short-lived certificates for managed instances.
- Review workspaces, changes, diffs, file context, commits, and conflicts from a touch-first layout.
- Start, inspect, attach to, and stop remote coding agents.
- Perform a deliberately limited set of safe, confirmed mutations.
- Recover cleanly from app suspension and network changes.

## Non-goals for initial mobile work

- A separate mobile codebase or a rewrite in a different framework.
- Provisioning implementation owned by the mobile app; provisioning remains a control-plane API.
- Port forwarding.
- Filesystem mounting.
- Storing private keys in Supabase.
- Arbitrary background SSH execution when prohibited by the operating system.
- Treating the mobile device as the source of truth for repository state.
- Automatically importing or trusting arbitrary mobile SSH profiles.

## Planned architecture

```text
Treq (single Tauri app, shared Rust core + React frontend)
  ├─ desktop targets (macOS/Windows/Linux)
  │    └─ Dashboard layout (multi-pane)
  └─ mobile targets (Android/iOS, via `tauri android` / `tauri ios`)
       └─ MobileShell layout (single-column, touch-first)
                 ↓ (same src-tauri commands on every target)
  ├─ local repository access (jj/git on-device or synced workspace)
  └─ once Remote SSH Control lands: native SSH client
       ├─ structured exec channels
       └─ interactive PTY channels
                 ↓
       User-managed or Treq-managed VM
         ├─ SSH server
         ├─ Treq CLI
         ├─ optional local agent supervisor
         └─ repositories and agents
```

## Mobile-specific concerns

### Key custody

The device creates or imports its key outside Treq's control-plane infrastructure. Private material remains in Keychain, Secure Enclave, Android Keystore, or equivalent protected storage. Supabase stores only the public key and device metadata.

### Host trust

Managed endpoint fingerprints come from the authenticated control plane. User-managed endpoints require explicit fingerprint configuration or an interactive first-trust flow that clearly distinguishes verification from convenience.

### App lifecycle

Mobile operating systems may suspend the app and close sockets. Structured operations must be bounded and safely retryable. Mutations use idempotency keys. Agent processes that must survive disconnects run under a VM-local supervisor and are reattached by session ID.

### Connection efficiency

One authenticated SSH connection should multiplex repository commands and PTY channels while the app is active. The implementation must avoid reconnecting for every file or diff request.

### Terminal UX

Terminal access is secondary to structured review and agent control. It requires mobile keyboard handling, resize behavior, binary-safe streaming, explicit connection state, and a clear statement when a session cannot be resumed.

## Candidate capability requirements

Any selected mobile SSH library must be evaluated for:

- supported platforms and license;
- active maintenance and vulnerability response;
- host-key verification callbacks;
- supported key algorithms;
- OpenSSH user certificates;
- platform key storage integration;
- connection and channel multiplexing;
- exec and PTY channels;
- terminal resize;
- keepalives and reconnect;
- cancellation and deadlines;
- memory and output limits;
- proxy support only if later required.

## Phased plan

### Phase 1: Build system and mobile shell (done)

- Add Android and iOS as Tauri build targets (`tauri android init` / `tauri ios init`, npm scripts, mobile app icons).
- Add a mobile-scoped Tauri capability file (`src-tauri/capabilities/mobile.json`).
- Add `MobileShell`, a touch-first top-level layout, and switch to it on mobile viewports via `useIsMobile`.
- Wire `MobileShell` to existing Tauri commands (e.g. `get_workspaces`) to prove the same IPC surface works unmodified on mobile.

### Phase 2: Security and connectivity prototype (this delivery)

The desktop app already has a real control-plane client (`lib/remote-control-plane.ts`), the `remote-ssh-trust` and `remote-instance` edge functions, and a russh-based native SSH transport with pinned host-key verification (`core::remote_ssh_transport`) reachable through `dispatchOverSsh`. None of that is SSH-library-prototype work mobile needs to redo - `russh` is pure Rust and compiles into the same mobile binary. What mobile Phase 2 adds is the piece desktop doesn't need: a way for a device with no `~/.ssh` to get a keypair and use it.

Done in this delivery:

- Authenticate to the control plane (reuses the existing Supabase auth session - no mobile-specific work needed).
- Generate and persist a per-device ed25519 keypair (`core::remote_device_key`, `ensure_mobile_device_key` command, `ensureMobileDeviceKey()`), since mobile has no `~/.ssh` identities to pick from.
- Store that private key in the OS-native keystore/keychain rather than app-local disk, via [`tauri-plugin-keystore`](https://github.com/impierce/tauri-plugin-keystore) (Android Keystore / iOS Keychain), gated on the device having biometrics enrolled via `tauri-plugin-biometric`. Both plugins are Rust-only integrations here (`core::remote_device_key::mobile_storage`) - the private key never crosses the Tauri IPC boundary to JS.
- Register the device public key with the control plane (`registerClientKey`, wired to the previously-unused `register_client_key` edge function action).
- Obtain a short-lived managed-instance certificate (`issueCertificate`, wired to `issue_certificate`).
- Verify the pinned host key and connect with the native (russh) SSH library - reused as-is from the existing transport; the certificate response's `endpoint.host_keys` feeds the same `HostKeyVerifier` desktop uses.
- Execute repository inspection (`ProbeRepo` over `dispatchOverSsh`) and display structured errors - `RemoteConnectPanel` in `MobileShell`.

Open items before this can ship as more than a prototype:

- `tauri-plugin-keystore` is pre-1.0 (`2.1.0-alpha.1` on crates.io) and its own desktop fallback hardcodes an unrelated identity and `unwrap()`s every error - real reasons desktop intentionally does not use it (see `core::remote_device_key` module docs) and mobile's usage should be re-audited against newer releases before shipping.
- Neither this plugin nor the biometric gate has been exercised on a real device or emulator - this sandbox has no Android SDK/NDK or Xcode, so the mobile-only code path (`#[cfg(mobile)]`) has been reviewed and its shared helpers unit-tested, but not built or run for an actual mobile target. First real verification should happen on-device via `npm run tauri:android:dev` / `tauri:ios:dev`.
- No UI path yet for the "biometrics not set up" error `require_biometrics` returns - `RemoteConnectPanel` currently surfaces it as the same generic connection error as everything else in the flow.

### Phase 3: Read-only review (this delivery)

Done in this delivery, built on `remote_dispatch_over_ssh` / `TreqCommandRequest`, which already implemented every read variant needed here (`ListWorkspaces`, `InspectWorkspace`, `ListChanges`, `DiffFile`, `ReadFile`, `ListCommits`, `ListConflicts`, `WorkspaceChangeMarker`) but had no UI calling them:

- Instance and repository selection (`RemoteConnectPanel`, unchanged from Phase 2, now persists the last repository path so reconnecting doesn't require retyping it).
- Workspace list and status (`RemoteRepoScreen`'s `WorkspaceListScreen`/`WorkspaceDetailScreen`).
- Changed files and structured diffs (`DiffScreen`, via `DiffFile`).
- Working-copy file context (`ReadFile` with `revision: "WorkingCopy"`, shown inline on the diff screen). Parent-revision context uses the same `ReadFile` request with `revision: "Parent"` and is wired the same way but not surfaced as a separate screen yet.
- Commit and conflict views (`CommitsScreen`, `ConflictsScreen`).
- Manual refresh per screen, plus a polled `WorkspaceChangeMarker` on the workspace detail screen so a stale op id is visible without a full data refetch.

Open items before this can ship as more than a prototype:

- No TypeScript types exist yet for the `TreqCommandRequest` JSON responses beyond what happens to match the existing local `api-types.ts` shapes (workspace/status/changes/diff/commit responses do line up with local desktop types today because both paths call the same Rust core functions - `ReadFile`'s `JjFileLines`, `ListCommits`' `JjLogCommit`, etc. - but that's convergence, not a contract; a future response shape change on either path could silently drift).
- Not exercised against a real managed instance or device - this sandbox has no way to provision one, so the mobile-only screens have been reviewed and type/lint-checked but not run against live SSH-dispatched data. First real verification should happen the same way Phase 2 flagged: on-device via `npm run tauri:android:dev` / `tauri:ios:dev` against an actual instance.
- No parent-file-context screen (only working-copy content is shown inline); no dedicated commit-diff or per-commit conflict detail view beyond the flat lists.

### Phase 4: Agent control (this delivery)

Done in this delivery, using the existing `AgentStart`/`AgentStatus`/`AgentStop`/`AgentLogs` `TreqCommandRequest` variants and the VM-local `core::agent_supervisor` they already dispatch to:

- Start an agent in a selected workspace (`RemoteAgentScreen`, `AgentStart` routed through `dispatchMutationOverSsh` for verify-before-retry semantics).
- Read status and bounded logs (`AgentStatus`/`AgentLogs`, polled every 4s while an agent is running).
- Stop a running agent (`AgentStop`).
- Reattach after app suspension: there is no distinct reattach request in the protocol - polling `AgentStatus`/`AgentLogs` again for the same `workspace` key after reconnecting is the reattach path, backed by `agent_supervisor`'s on-disk record surviving process/connection restarts.

Explicitly not done, and not silently stubbed:

- Sending input to a running agent. `core::agent_supervisor::send_agent_input` returns `not_implemented` today (the supervisor does not keep a child process's stdin open across separate CLI/exec invocations) - this is a real backend limitation, not missing UI, so the agent screen states this plainly instead of offering an input box that would always fail.
- Structured permission-request handling. Neither `AgentStatusResult` nor the log output distinguishes "waiting on a permission prompt" from ordinary running/log state in the current protocol, so there is no permission-response UI yet; adding it needs a small protocol addition (a status field or event) before it can be built as more than a generic text box.

### Phase 5: Controlled mutations

- Workspace creation and rebase.
- Patch application.
- Commit creation.
- Conflict resolution.
- Bookmark push with explicit confirmation.

### Phase 6: Mobile test infrastructure

- Real control-plane test project.
- Real provider test instances.
- Device key and certificate issuance tests.
- Host-key mismatch and rotation tests.
- Network transition and app suspension tests.
- Idempotent mutation retry tests.
- Resource cleanup and cost controls.

## Acceptance criteria for a future mobile MVP

1. A mobile client can authenticate, select an authorized instance, and retrieve trusted endpoint metadata.
2. The private key never leaves protected device storage.
3. The client rejects a mismatched host key.
4. The client authenticates to a managed VM with a short-lived certificate.
5. The client renders remote workspace and review data without cloning the repository locally.
6. A structured mutation can be retried without duplicate effects.
7. An agent started on the VM remains observable after the mobile app reconnects.
8. Losing or revoking one device does not revoke other registered devices.

## Open questions

- Which native SSH library meets the certificate, host verification, PTY, and platform-security requirements?
- Can hardware-backed keys be used directly by the chosen SSH library on both mobile platforms?
- Which agent interactions require push notifications?
- Which mutations are safe and ergonomic enough for the first mobile release?
- What terminal functionality is necessary beyond structured agent control?
