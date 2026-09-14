# Mobile Remote Control

## Status

Active. Mobile is the existing Tauri desktop codebase compiled for Android/iOS, not a separate application. A prior revision of this PRD scaffolded a standalone React Native app (`mobile/`) with a dedicated Rust SSH crate (`crates/treq-mobile-ssh`) and a UniFFI native-module bridge, on the reasoning that a bespoke SSH client would be more portable. That path has been reverted in full: the React Native app, its Kotlin/Swift bridge code, `crates/treq-mobile-ssh`, and the RN-specific CI workflows are removed. Treq mobile is once again `tauri android`/`tauri ios` builds of `src-tauri`, sharing one Rust core and one React frontend with desktop, per the original architecture below.

## Summary

Treq mobile is the same Tauri application as desktop, built for Android and iOS via `tauri android build` / `tauri ios build`, not a separate codebase. It talks to the same control-plane APIs and, over SSH, the same allow-listed Treq CLI commands that the desktop app uses, through `src-tauri`'s existing native (`russh`-based) SSH transport (`core::remote`, `core::remote_ssh_transport`) and the same Tauri IPC commands (`lib/api.ts`) desktop calls - not a separate bridge or crate.

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
- Open a full, interactive PTY over the SSH connection - not only the structured `agent-remote` polling loop - with real-time bidirectional streaming, resize, and the ability to detach and later reattach to the same running remote session (see Phase 7).

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

Structured review and agent control (Phases 3-4) ship first and remain the primary way most mutations and agent lifecycle actions happen, but a full interactive PTY - not only `agent-remote`'s poll-and-command loop - is a required capability, not a nice-to-have: some agent TUIs and ad hoc shell use have no structured equivalent. It requires mobile keyboard handling, resize behavior, binary-safe streaming, explicit connection state, and detach/reattach so a session survives an app suspension, a dropped connection, or an app relaunch without losing the running remote process (see Phase 7 for the mobile-first implementation and Phase 8 for desktop parity).

## Candidate capability requirements

The native (russh-based) SSH transport `src-tauri` already ships (`core::remote_ssh_transport`) must be evaluated for, and cover, the same requirements a third-party mobile SSH library would have needed:

- host-key verification callbacks;
- supported key algorithms;
- OpenSSH user certificates;
- platform key storage integration (`tauri-plugin-keystore`/`tauri-plugin-biometric` on mobile targets);
- connection and channel multiplexing;
- exec and PTY channels;
- terminal resize;
- keepalives and reconnect;
- cancellation and deadlines;
- memory and output limits;
- proxy support only if later required.

## Phased plan

**Architecture note:** a prior revision of this PRD redirected Phases 1-6 into a standalone React Native app (`mobile/`) with its own Rust SSH crate (`crates/treq-mobile-ssh`, `russh` + UniFFI) and a native module bridge (Swift/Kotlin). That app, crate, and bridge have been deleted; the phases below are redone against the restored Tauri architecture (`MobileShell`, `RemoteConnectPanel`, `core::remote_device_key` using `tauri-plugin-keystore`/`tauri-plugin-biometric`, `tauri android`/`tauri ios` build targets). Phase numbering and scope are unchanged from the original PRD; statuses below reflect the Tauri implementation.

### Phase 1: Build system and mobile shell (done)

- `tauri android build` / `tauri ios build` (scripted via `npm run mobile:android:build` / `npm run mobile:ios:build`, with `mobile:android:init` / `mobile:ios:init` scaffolding `src-tauri/gen/{android,apple}` on first run) compile the existing `src-tauri` app for Android/iOS - no separate codebase, no separate package manifest.
- `src-tauri/capabilities/mobile.json` - a mobile-scoped Tauri capability set distinct from desktop's, dropping desktop-only capabilities (multi-window, CLI plugin) that don't apply on mobile.
- `src/components/MobileShell.tsx` - a single-column, touch-first layout rendered instead of the desktop `Dashboard` when `useIsMobile()` detects a mobile viewport (`src/App.tsx`), calling the same `lib/api.ts` Tauri commands desktop's `Dashboard` uses.
- `.github/workflows/mobile.yml` - CI jobs that init and build both the Android APK and iOS app bundle on every relevant PR.

Done. See Phase 2 below for the connectivity layer `MobileShell` calls into.

### Phase 2: Security and connectivity prototype (control-plane path wired)

Done:

- Generate a per-device ed25519 keypair on first use and return only its public material (`core::remote_device_key::ensure_device_key`, exposed as the `ensure_mobile_device_key` Tauri command).
- Store that private key in OS-native secure storage without it ever crossing into the JS/webview layer: `tauri-plugin-keystore` (Android Keystore) and `tauri-plugin-biometric` (iOS Keychain/Secure Enclave, gated behind biometric or device-passcode auth), both `#[cfg(mobile)]`-registered plugins with no desktop implementation worth shipping.
- Verify a pinned host-key fingerprint and connect with the same native (russh) SSH transport desktop uses (`core::remote_ssh_transport`, `HostKeyVerifier`), rejecting a mismatched fingerprint - shared code, not a mobile-specific reimplementation.
- Authenticate with a short-lived OpenSSH user certificate instead of direct public-key auth (`core::remote`'s `authenticate_openssh_cert`), for the managed-instance path.
- `src/components/RemoteConnectPanel.tsx`: generate/regenerate the device key, register it against the control plane, and drive the managed-instance connect flow, rendered inside `MobileShell`.
- Supabase auth and device-key registration/certificate issuance against the real `remote-ssh-trust`/`remote-instance` edge functions, exercised end to end in `scripts/service-qa/specs/mobile-control-plane.spec.ts` against a real local Supabase CLI stack (`npm run service-qa:up && npm run service-qa`).

Open items before this is more than a prototype:

- No production Android/iOS release build has been produced or code-signed yet in this environment - `.github/workflows/mobile.yml` currently builds unsigned debug artifacts only. Signed release pipelines (Play Store / TestFlight) are future work, not scoped to this pass.
- No UI for the "biometrics not set up" / secure-storage-unavailable case.

### Phase 3: Read-only review (done)

`MobileShell` dispatches the same `TreqCommandRequest` JSON protocol desktop's `remote_dispatch_over_ssh`/`remote_dispatch_local` already implement - mobile needs no separate command protocol or CLI-parsing layer, since it is the same Tauri backend.

Workspace selection in `MobileShell` opens a touch-first, single-column workspace view with three tabs, all built on the same `lib/api.ts` calls desktop's `Dashboard` uses - no new backend/IPC surface:

- **Changes** (`src/components/mobile/MobileDiffView.tsx`) - the working-copy diff via `getWorkspaceDiff`, collapsible per-file hunks (`MobileFileDiffList`/`MobileHunkView`). Uncommitted files fetch their hunks separately via `getWorkspaceFileHunksBatch`, since `getWorkspaceDiff`'s `hunks_by_file` only covers `committed_files`.
- **History** (`src/components/mobile/MobileCommitView.tsx`) - reuses `LinearCommitHistory` as-is for the commit list, with drill-down into a single commit's diff via `getCommitDiff`.
- **Conflicts** (`src/components/mobile/MobileConflictView.tsx`) - reuses `ConflictsSection` as-is for the conflicted-file list, with drill-down into conflict markers. A committed (e.g. rebase) conflict's `conflict_regions` live in `getWorkspaceDiff`'s `hunks_by_file`; the view falls back to `getWorkspaceFileHunks` for a conflict still only present in an uncommitted working-copy edit.

Verified against a real jj repo (uncommitted change, a commit, and a real merge conflict) via `scripts/screenshot/specs/mobile-shell-review.spec.tsx`.

### Phase 4: Agent control (not started)

Scope: a mobile screen that starts, inspects, sends input to, and stops a remote coding agent via the same `agent-remote start`/`input`/`status`/`stop`/`logs` commands desktop's `core::agent_supervisor` and `RemoteTerminalPanel` already call through `lib/api-extra.ts` - no new backend work, only a mobile-shell UI surface. Not yet built.

### Phase 5: Controlled mutations (not started)

Scope: expose the same idempotency-keyed mutation commands (`core::remote`'s `with_idempotency_key`-backed workspace creation, rebase, commit creation, conflict resolution, bookmark push) already used by desktop's `Dashboard`, from `MobileShell`'s single-column layout with explicit confirmation before dispatch. Not yet built.

### Phase 6: Mobile test infrastructure (partial)

- Real control-plane test project - done: `scripts/service-qa/specs/mobile-control-plane.spec.ts` exercises the device-key/certificate/managed-instance request-response shapes the Tauri commands use, against a real local Supabase CLI stack (`npm run service-qa:up && npm run service-qa`).
- Real provider test instances - not mobile-specific work: `remote-instance`'s provisioning path is shared with desktop and already runs against `StubSpritesProvider` in service-qa (`REMOTE_SPRITES_STUB=1`); a real Fly Sprites account in CI is tracked under [Remote SSH Control](./remote-ssh.md), not here.
- Device key and certificate issuance tests, host-key mismatch/rotation tests - covered by `core::remote`/`core::remote_ssh_transport`'s existing desktop test suite, since mobile shares that code rather than duplicating it.
- Mobile-shell-specific UI tests (screenshot/app-qa coverage of `MobileShell`, `RemoteConnectPanel`) - not yet built.

### Phase 7: Full PTY streaming and reattach - mobile client (backend done and shared with desktop; mobile UI not started)

Scope: give mobile a real interactive terminal over the SSH connection - live bidirectional byte streaming, resize, and the ability to detach (leave the remote process running) and later reattach to that same session - superseding polling for anything that needs true interactivity (raw agent TUIs, ad hoc shell use). A future mobile agent-control screen's polling loop (Phase 4) would stay as the lighter-weight structured path for agents that don't need a live terminal; this phase adds the PTY path alongside it, it does not replace it.

Because mobile is the same Tauri app as desktop, there is no separate mobile SSH crate or native-module bridge to build here: items 1-2 below are shared, already-tested backend code, and item 3 is exactly desktop's `RemoteTerminalPanel`/`RemoteTerminalDialog` (Phase 8) rendered inside `MobileShell` instead of `Dashboard` - not a reimplementation.

**1. VM-local persistent PTY supervisor - done.** `core::pty_remote_supervisor` (`src-tauri/src/core/pty_remote_supervisor.rs`) implements the `pty-remote` CLI surface as a new subcommand alongside `agent-remote` (`start`/`list`/`stop`/`attach-command`, wired through `tauri.conf.json`'s CLI schema and `cli::mod::parse_remote_command_request`/`handle_cli_command`, and four new `TreqCommandRequest` variants - `PtyStart`/`PtyList`/`PtyStop`/`PtyAttachCommand` - following `agent-remote`'s existing `is_mutation`/`requires_idempotency_key`/`kind_name`/`KIND_NAMES`/`cli_args`/`execute_local_request` pattern exactly, including the TypeScript `TREQ_COMMAND_KINDS` mirror in `src/lib/remote-dispatch.ts`).

  Implementation decision (resolves the open question below): **tmux-backed, with `screen` as a fallback**, not a custom fork+setsid+pty+ring-buffer supervisor - documented in the module's doc comment. A session is a single detached `tmux`/`screen` session named `treq-pty-<workspace>-<label>`; `start`/`list`/`stop` shell out to `tmux new-session -d`/`list-sessions`/`kill-session` (or the `screen` equivalents); `build_attach_command` returns the literal command line an SSH PTY channel execs - `cd <dir> && exec tmux new-session -A -s <name> ...` - mirroring `core::remote_pty::build_launch_command`'s shape and quoting discipline (`shell_quote` on every dynamic component). `tmux new-session -A` ("attach if it exists, else create") makes one command line cover both first-start and reattach, so a caller never needs to know in advance which case applies. Resize does not need its own wire message on the hot path: tmux/screen auto-resize to the attached client's window on the SSH channel's own `window_change_request`; `resize_session` exists for the pre-attach case. The accepted trade-off: this depends on `tmux` or `screen` being installed on the remote host, and fails with a clear `dependency_error` (not a silent non-persistent fallback) when neither is present - acceptable for Treq's managed-instance provisioning path, an open risk for arbitrary user-managed endpoints (noted in Open Questions below, no longer entirely open: the decision is "depend on it, fail loudly," not "always degrade silently").

  Tested with 6 real tests in `pty_remote_supervisor::tests` run against a live local `tmux` server (not mocked): `session_name_sanitizes_unsafe_characters`, `parse_session_name_round_trips_through_session_name`, `build_attach_command_quotes_a_malicious_working_directory`, `build_attach_command_errors_clearly_when_no_backend_detected`, `start_list_stop_lifecycle_round_trips_against_a_real_tmux_server` (start is idempotent, list finds it, stop removes it, stop is idempotent), `attach_command_reattaches_to_an_existing_session_without_recreating_it`.

**2. PTY channel primitives - done and tested, shared with desktop.** `core::remote_pty`'s `RemotePtyManager` (the same module Phase 8's desktop terminal uses) opens PTY channels, writes, resizes, and streams output/exit events over the native russh transport. There is no separate crate or FFI layer for mobile to duplicate this: `create_with_command` (Phase 8) already supports opening a PTY against an already-built command line, which is exactly what a mobile reattach needs from `pty-remote attach-command`.

**3. Mobile UI - not started.** The remaining work is rendering desktop's Phase 8 terminal components (`RemoteTerminalPanel`, `RemoteTerminalDialog`) inside `MobileShell`'s single-column layout instead of building a new terminal surface: same Tauri commands (`remotePtyListPersistentSessions`, `remotePtyReattach`, `remote_pty_create`/`remote_pty_write`/`remote_pty_resize`/`remote_pty_stop` in `lib/api-extra.ts`), same xterm.js-in-webview rendering approach Tauri's webview already provides natively on both platforms (no separate WebView bridge needed, unlike the removed React Native path). Needs: a touch-friendly on-screen keyboard/toolbar for control sequences (Ctrl, Esc, arrows) that a mobile software keyboard doesn't supply, and verification on real Android/iOS devices or simulators (not yet available in this environment).

### Phase 8: Full PTY streaming and reattach - desktop client (done: backend commands and UI both in place)

Brings desktop toward parity with the mobile PTY/reattach experience Phase 7 builds, now that the shared `pty-remote` VM-local supervisor (Phase 7, item 1) exists.

- **Done:** `core::remote_pty::RemotePtyManager::create` now delegates to a new `create_with_command(binding, endpoint, command: &str, cols, rows, on_output, on_exit)`, which opens a PTY channel with an already-built command line instead of assembling one from a `PtyLaunchSpec` - `create`'s existing callers are unaffected (it still builds a spec-derived command and delegates), and `create_with_command` is what reattach needs, since the command comes from the VM's `pty-remote attach-command` response rather than from a `PtyLaunchSpec` this process would build itself. Covered by a new test, `create_with_command_opens_a_pty_with_an_already_built_command_line`, against the module's existing mock echo SSH server.
- **Done:** two new Tauri commands in `commands/remote_pty_commands.rs` - `remote_pty_list_persistent_sessions` (a thin wrapper: `TreqCommandRequest::PtyList` needed no new plumbing at all beyond the existing generic `remote_dispatch_over_ssh`/`execute_remote_command` path, so this command exists mostly for callers that would rather not build that request by hand) and `remote_pty_reattach` (fetches the literal attach command via `TreqCommandRequest::PtyAttachCommand`, then opens a live PTY channel with it via `create_with_command`, emitting the same `remote-pty-data-<session_id>`/`remote-pty-exit-<session_id>` events `remote_pty_create` already does - a caller does not need a separate code path for "reattach" vs. "fresh session"). Both registered in `lib.rs`'s Tauri command list.
- **Done:** a desktop terminal UI wired to the commands above. `src/components/RemoteTerminalPanel.tsx` renders an xterm.js terminal against a live remote PTY (mirroring `ConsolidatedTerminal`'s fit-addon/resize-observer wiring but over the `remotePty*` IPC surface in `lib/api-extra.ts` instead of the local one); unmounting it is "Detach" (the VM-local `pty-remote` session keeps running, matching mobile's Detach semantics), and a "Stop" button additionally dispatches `PtyStop` to kill the remote session. `src/components/RemoteTerminalDialog.tsx` is the entry point: on open it calls `remote_pty_list_persistent_sessions` and offers "Reattach" against any already-running session or "Start new" with a fresh label, covering the originally-scoped "list running sessions and offer reattach" behavior. `Dashboard.tsx` wires a "Terminal" button into the existing remote-repo status bar (shown whenever `activeSshEndpoint` is connected), opening the dialog against the active repository's canonical path. `lib/api-extra.ts` gained `remotePtyListPersistentSessions`/`remotePtyReattach` wrappers over the two Phase 8 backend commands.
  Known simplification (mirrors Phase 7 item 3's mobile version of the same trade-off): the terminal opens at the connected repo's root, not inside a specific workspace's own checkout directory, since this entry point sits above workspace selection in the current UI; it uses a fixed `"root"` workspace label rather than a real per-workspace id. Not verified against a real SSH endpoint/VM in this environment (no live managed instance to connect to) - typechecks clean and the existing `remote-pty-api.test.ts` IPC-mapping tests still pass, but the xterm.js/live-PTY path itself has only been reviewed by eye against `ConsolidatedTerminal`'s established pattern, the same caveat Phase 7's mobile `TerminalScreen.tsx` carries for its own unverified-on-device WebView path.
- **Done:** retired the `remote-ssh.md` "terminal reconnect may be explicitly unsupported after the client exits" carve-out (see that document's update) now that the backend half of reattach exists; the carve-out note there now points at this section for what remains (the desktop UI).


## Acceptance criteria for a future mobile MVP

1. A mobile client can authenticate, select an authorized instance, and retrieve trusted endpoint metadata.
2. The private key never leaves protected device storage.
3. The client rejects a mismatched host key.
4. The client authenticates to a managed VM with a short-lived certificate.
5. The client renders remote workspace and review data without cloning the repository locally.
6. A structured mutation can be retried without duplicate effects.
7. An agent started on the VM remains observable after the mobile app reconnects.
8. Losing or revoking one device does not revoke other registered devices.
9. A user can open a full interactive PTY on the VM, type into it, see live output, resize it, detach without killing the remote process, and reattach later (after backgrounding the app, losing connectivity, or relaunching) and pick up where they left off.

## Open questions

- Which agent interactions require push notifications, and how does a Tauri mobile build register for them on each platform?
- Which mutations are safe and ergonomic enough for the first mobile release?
- What terminal functionality is necessary beyond structured agent control, and what on-screen controls (Ctrl/Esc/arrow toolbar) does a touch keyboard need that desktop's `RemoteTerminalPanel` doesn't provide today?
- ~~`tmux`/`screen`-backed persistent PTY vs. a custom Treq-owned supervisor process for reattach~~ - resolved by implementation: `core::pty_remote_supervisor` picks tmux (screen fallback), failing loudly with `dependency_error` when neither is installed rather than silently degrading. Still genuinely open: whether Treq's managed-instance provisioning should be changed to *guarantee* tmux is present (it isn't guaranteed today), and what a user-managed endpoint without either should be told beyond the error message.
- How much output backlog should a reattach replay by default, and should that be configurable per session or fixed? Still open - `pty_remote_supervisor` relies on tmux/screen's own scrollback (whatever size that is configured to, not something Treq controls), it does not implement its own backlog cap.
- Should concurrent multi-attach (two clients, e.g. mobile and desktop, attached to the same remote PTY at once) be supported from the start, or restricted to one attacher at a time initially even though the underlying `tmux`/`screen` primitive allows more?
