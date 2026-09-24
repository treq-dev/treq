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
- Distinguish "secure storage / biometrics not set up" from a generic connection failure in the UI: `core::remote_device_key`'s mobile storage path now prefixes that error string with a machine-checkable `secure_storage_unavailable:` marker (see `SECURE_STORAGE_UNAVAILABLE_PREFIX`), and `RemoteConnectPanel` checks for it to render a dedicated "set up biometrics in your device settings" state (`RemoteConnectPanel.test.tsx`) instead of the generic error text every other failure gets.
- A CI mobile build pipeline (`.github/workflows/mobile.yml`): unsigned debug builds for Android and iOS run on every PR/push touching mobile code (no secrets needed, so forked PRs still build), plus signed-release jobs (`android-release`, `ios-release`) that decode an Android keystore / Apple signing certificate and provisioning profile from GitHub Actions secrets, wire them into the generated Gradle project (`keystore.properties`) or a temporary CI keychain, and upload a signed APK/AAB or IPA as a workflow artifact. The release jobs are gated on `github.event_name != 'pull_request'` (so a fork PR run never even attempts them) and additionally no-op with a clear log line if the expected secrets aren't configured, so pushes to `main` before secrets exist don't fail the workflow.

Open items before this is more than a prototype:

- `tauri-plugin-keystore` is pre-1.0 (`2.1.0-alpha.1` on crates.io) and its own desktop fallback hardcodes an unrelated identity and `unwrap()`s every error - real reasons desktop intentionally does not use it (see `core::remote_device_key` module docs) and mobile's usage should be re-audited against newer releases before shipping.
- Neither this plugin nor the biometric gate has been exercised on a real device or emulator - this sandbox has no Android SDK/NDK or Xcode, so the mobile-only code path (`#[cfg(mobile)]`) has been reviewed and its shared helpers unit-tested, but not built or run for an actual mobile target. First real verification should happen on-device via `npm run mobile:android:dev` / `mobile:ios:dev`.
- `.github/workflows/mobile.yml`'s signed-release path is unverified end to end: this sandbox has no Apple Developer account, Android signing keystore, Android SDK/NDK, or Xcode, so the workflow YAML and shell have been reviewed and checked for syntax/well-formedness only (`python3 -c "import yaml; yaml.safe_load(...)"`) - no actual signed APK/AAB or IPA has ever been produced or tested by this pipeline. First real verification needs a maintainer to configure the `ANDROID_*`/`IOS_*` secrets documented in the workflow's comments and trigger a push to `main` or a tag.
- The `secure_storage_unavailable:` UI state has only been exercised via a mocked `ensureMobileDeviceKey()` rejection in `RemoteConnectPanel.test.tsx` (jsdom, no real biometric/keystore plugin) - real on-device verification of the actual error string `require_biometrics` produces is still pending the same on-device pass as the rest of Phase 2.

### Phase 3: Read-only review (done)

`MobileShell` dispatches the same `TreqCommandRequest` JSON protocol desktop's `remote_dispatch_over_ssh`/`remote_dispatch_local` already implement - mobile needs no separate command protocol or CLI-parsing layer, since it is the same Tauri backend.

Workspace selection in `MobileShell` opens a touch-first, single-column workspace view with three tabs, all built on the same `lib/api.ts` calls desktop's `Dashboard` uses - no new backend/IPC surface:

- **Changes** (`src/components/mobile/MobileDiffView.tsx`) - the working-copy diff via `getWorkspaceDiff`, collapsible per-file hunks (`MobileFileDiffList`/`MobileHunkView`). Uncommitted files fetch their hunks separately via `getWorkspaceFileHunksBatch`, since `getWorkspaceDiff`'s `hunks_by_file` only covers `committed_files`.
- **History** (`src/components/mobile/MobileCommitView.tsx`) - reuses `LinearCommitHistory` as-is for the commit list, with drill-down into a single commit's diff via `getCommitDiff`.
- **Conflicts** (`src/components/mobile/MobileConflictView.tsx`) - reuses `ConflictsSection` as-is for the conflicted-file list, with drill-down into conflict markers. A committed (e.g. rebase) conflict's `conflict_regions` live in `getWorkspaceDiff`'s `hunks_by_file`; the view falls back to `getWorkspaceFileHunks` for a conflict still only present in an uncommitted working-copy edit.

Verified against a real jj repo (uncommitted change, a commit, and a real merge conflict) via `scripts/screenshot/specs/mobile-shell-review.spec.tsx`.

**Local AI code review:** `MobileDiffView` reuses the same `useAgentReviewComments` hook, `AgentReviewContext`/`AgentReviewInlineList`, and `AgentReviewCommentCard` desktop's Changes tab uses (`src/components/changes-diff-viewer/`), rather than a mobile-specific implementation - `MobileHunkView` computes each line's number the same way desktop does (`computeHunkLineNumbers`) and renders `AgentReviewInlineList` under the matching line. A comment left by a review run elsewhere (desktop, or `treq agent-review add` from a terminal) shows up here badged "Local" with Resolve, Delete, and Apply (suggested-change diff included), plus an unresolved-comment count above the file list. Mobile has no local terminal to launch a *new* review from, so there is no mobile "Start Review" entry point and no mobile equivalent of "Send to agent" - only acting on comments left by a review triggered elsewhere.

### Phase 4: Agent control (done)

`src/components/RemoteAgentScreen.tsx`, reached from `RemoteRepoScreen`'s per-workspace "Agent" button (itself reached from `MobileShell` -> `RemoteConnectPanel` -> `RemoteRepoScreen`), starts, inspects, sends input to, and stops a remote coding agent via typed `TreqCommandRequest` dispatch (`AgentStart`/`AgentInput`/`AgentStatus`/`AgentStop`/`AgentLogs`) over `dispatchOverSsh`/`dispatchMutationOverSsh` - the same `core::agent_supervisor` commands desktop's CLI (`agent-remote`) drives. No new backend work: this is entirely the mobile-shell UI surface described in scope. Status and logs poll on an interval; start/stop/input go through `dispatchMutationOverSsh` so a network failure during the request surfaces as `ambiguous` rather than silently retrying.

### Phase 5: Controlled mutations (done)

`src/components/RemoteWorkspaceMutationScreens.tsx` and `RemoteRepoScreen.tsx` expose the same idempotency-keyed mutation commands (`core::remote`'s `with_idempotency_key`-backed `CreateWorkspace`, `RebaseWorkspace`, `CreateCommit`, `ResolveConflict`, `GitPush`) already used by desktop, from the same single-column mobile screens Phase 3/4 added. `MutationButton` (`src/components/remote/RemoteScreenControls.tsx`) implements the "explicit confirmation before dispatch" requirement as an arm/confirm pattern - a first tap arms the button and relabels it "Confirm ...", a second tap (or a blur, which disarms) is required to actually dispatch - rather than a separate modal dialog, to fit the single-column touch layout. Each mutation surfaces `MutationDispatchResult`'s `"ambiguous"` outcome as an inline error instead of assuming success.

### Phase 6: Mobile test infrastructure (partial)

- Real control-plane test project - done: `scripts/service-qa/specs/mobile-control-plane.spec.ts` exercises the device-key/certificate/managed-instance request-response shapes the Tauri commands use, against a real local Supabase CLI stack (`npm run service-qa:up && npm run service-qa`).
- Real provider test instances - not mobile-specific work: `remote-instance`'s provisioning path is shared with desktop and already runs against `StubSpritesProvider` in service-qa (`REMOTE_SPRITES_STUB=1`); a real Fly Sprites account in CI is tracked under [Remote SSH Control](./remote-ssh.md), not here.
- Device key and certificate issuance tests, host-key mismatch/rotation tests - covered by `core::remote`/`core::remote_ssh_transport`'s existing desktop test suite, since mobile shares that code rather than duplicating it.
- Mobile-shell-specific UI tests (screenshot/app-qa coverage of `MobileShell`, `RemoteConnectPanel`) - done: `scripts/screenshot/specs/mobile-shell-review.spec.tsx` captures `RemoteConnectPanel`'s idle "Connect to managed instance" state (it renders unconditionally below `MobileShell`'s local review content, so no mocking is needed for this step), and now also its connected state (endpoint shown, repository-path input, "Inspect repository") and an error state (a failed `ProbeRepo` dispatch surfaced as an inline destructive message while still connected). The connected/error captures mock the control-plane calls (`ensureMobileDeviceKey`/`registerClientKey`/`getInstanceStatus`/`issueCertificate`) and `dispatchOverSsh`, following the same `vi.mock` + `importActual` pattern `RemoteTerminalScreen.test.tsx` already used for its own SSH-dispatch mocking - no new mocking approach was invented. Still open: this is jsdom-rendered/Chromium-rasterized coverage of the real component tree, not verification against a real control plane or managed instance (see the real-control-plane-project bullet above, and Phase 2/3's own device-verification caveats).

### Phase 7: Full PTY streaming and reattach - mobile client (backend done and shared with desktop; mobile UI now in place, unverified on device)

Scope: give mobile a real interactive terminal over the SSH connection - live bidirectional byte streaming, resize, and the ability to detach (leave the remote process running) and later reattach to that same session - superseding polling for anything that needs true interactivity (raw agent TUIs, ad hoc shell use). A future mobile agent-control screen's polling loop (Phase 4) would stay as the lighter-weight structured path for agents that don't need a live terminal; this phase adds the PTY path alongside it, it does not replace it.

Because mobile is the same Tauri app as desktop, there is no separate mobile SSH crate or native-module bridge to build here: items 1-2 below are shared, already-tested backend code, and item 3 is exactly desktop's `RemoteTerminalPanel`/`RemoteTerminalDialog` (Phase 8) rendered inside `MobileShell` instead of `Dashboard` - not a reimplementation.

**1. VM-local persistent PTY supervisor - done.** `core::pty_remote_supervisor` (`src-tauri/src/core/pty_remote_supervisor.rs`) implements the `pty-remote` CLI surface as a new subcommand alongside `agent-remote` (`start`/`list`/`stop`/`attach-command`, wired through `tauri.conf.json`'s CLI schema and `cli::mod::parse_remote_command_request`/`handle_cli_command`, and four new `TreqCommandRequest` variants - `PtyStart`/`PtyList`/`PtyStop`/`PtyAttachCommand` - following `agent-remote`'s existing `is_mutation`/`requires_idempotency_key`/`kind_name`/`KIND_NAMES`/`cli_args`/`execute_local_request` pattern exactly, including the TypeScript `TREQ_COMMAND_KINDS` mirror in `src/lib/remote-dispatch.ts`).

  Implementation decision (resolves the open question below): **tmux-backed, with `screen` as a fallback**, not a custom fork+setsid+pty+ring-buffer supervisor - documented in the module's doc comment. A session is a single detached `tmux`/`screen` session named `treq-pty-<workspace>-<label>`; `start`/`list`/`stop` shell out to `tmux new-session -d`/`list-sessions`/`kill-session` (or the `screen` equivalents); `build_attach_command` returns the literal command line an SSH PTY channel execs - `cd <dir> && exec tmux new-session -A -s <name> ...` - mirroring `core::remote_pty::build_launch_command`'s shape and quoting discipline (`shell_quote` on every dynamic component). `tmux new-session -A` ("attach if it exists, else create") makes one command line cover both first-start and reattach, so a caller never needs to know in advance which case applies. Resize does not need its own wire message on the hot path: tmux/screen auto-resize to the attached client's window on the SSH channel's own `window_change_request`; `resize_session` exists for the pre-attach case. The accepted trade-off: this depends on `tmux` or `screen` being installed on the remote host, and fails with a clear `dependency_error` (not a silent non-persistent fallback) when neither is present - acceptable for Treq's managed-instance provisioning path, an open risk for arbitrary user-managed endpoints (noted in Open Questions below, no longer entirely open: the decision is "depend on it, fail loudly," not "always degrade silently").

  Tested with 6 real tests in `pty_remote_supervisor::tests` run against a live local `tmux` server (not mocked): `session_name_sanitizes_unsafe_characters`, `parse_session_name_round_trips_through_session_name`, `build_attach_command_quotes_a_malicious_working_directory`, `build_attach_command_errors_clearly_when_no_backend_detected`, `start_list_stop_lifecycle_round_trips_against_a_real_tmux_server` (start is idempotent, list finds it, stop removes it, stop is idempotent), `attach_command_reattaches_to_an_existing_session_without_recreating_it`.

**2. PTY channel primitives - done and tested, shared with desktop.** `core::remote_pty`'s `RemotePtyManager` (the same module Phase 8's desktop terminal uses) opens PTY channels, writes, resizes, and streams output/exit events over the native russh transport. There is no separate crate or FFI layer for mobile to duplicate this: `create_with_command` (Phase 8) already supports opening a PTY against an already-built command line, which is exactly what a mobile reattach needs from `pty-remote attach-command`.

**3. Mobile UI - done, not yet device-verified.** `src/components/mobile/RemoteTerminalScreen.tsx` is a full-screen counterpart to desktop's `RemoteTerminalDialog`: it lists persistent `pty-remote` sessions for the workspace via `remotePtyListPersistentSessions` and offers "Reattach" per running session or "Start new session", then renders the existing `RemoteTerminalPanel` unchanged (same `remotePty*` IPC surface, same xterm.js-in-webview rendering desktop uses - no separate terminal implementation). Reached from `RemoteRepoScreen`'s per-workspace "Terminal" button (`WorkspaceDetailScreen`, alongside the existing Commits/Conflicts/Agent buttons), added as a new `{ name: "terminal"; workspace: string }` `Screen` variant.

`RemoteTerminalPanel` gained an optional `renderToolbar` prop (a `(send: (data: string) => void) => ReactNode` render prop, backed by the same `remotePtyWrite(sessionId, ...)` call the terminal's own key handling uses) so callers can attach extra chrome without duplicating the session-write wiring; desktop's `RemoteTerminalDialog` passes nothing and is unaffected. `src/components/mobile/RemoteTerminalTouchToolbar.tsx` is the new on-screen control-sequence toolbar this enables - Esc/Tab/Ctrl+C/Ctrl+D/Ctrl+Z and arrow keys, each a button sending the literal byte sequence a physical key would produce, for TUIs and shell use a touch keyboard alone can't drive.

Screenshot/app-qa coverage - done: `scripts/screenshot/specs/remote-terminal-screen.spec.tsx` renders `RemoteTerminalScreen` directly against a connected `SshEndpoint` fixture, mocking `remote-dispatch`'s `dispatchOverSsh` (for `ListWorkspaces`) and `api-extra`'s `remotePty*` IPC calls the same way `RemoteTerminalScreen.test.tsx` already did for its unit coverage - the xterm.js rendering itself is not mocked, it's the same real `@xterm/xterm` instance other terminal specs (e.g. `terminal-sessions-sidebar.spec.tsx`) already prove rasterizes through this harness. It captures the persistent-session list (a running session with an enabled "Reattach" button, a stopped one with "Reattach" disabled, and "Start new session") and the started-session state (`RemoteTerminalPanel`'s header, Stop/Detach controls, and the touch toolbar, with the loading overlay cleared).

Not yet done: verification on real Android/iOS devices or simulators (not available in this environment - same caveat desktop's Phase 8 terminal carries for its own review-only verification). This is out of scope for app-qa/screenshot coverage, which can only exercise the jsdom-rendered/Chromium-rasterized component tree against mocked IPC, not a real device's WebView or a real managed instance.

**Fixed (post-audit):** `RemoteTerminalScreen.tsx` originally opened every terminal at the repo root (`remoteWorkingDirectory: repo`) instead of the workspace's own checkout directory, even though the component has the real `workspace` prop available - unlike desktop's root-only Phase 8 shortcut, mobile's screen had no excuse for this. It now fetches `ListWorkspaces` on mount, resolves the selected workspace's `workspace_path`, and uses that as `remoteWorkingDirectory` for both "Reattach" and "Start new session" (falling back to the repo root only if the workspace can't be found). Covered by `src/components/mobile/RemoteTerminalScreen.test.tsx`, written first against the bug and confirmed red before the fix.

**Hardened (post-audit):** `remote_pty_reattach`'s `command: String` Tauri parameter previously crossed the IPC boundary as an unvalidated raw string, forwarded into `TreqCommandRequest::PtyAttachCommand` and ultimately interpolated *unquoted* into `pty_remote_supervisor::build_attach_command`'s returned shell command line (safe today only because the sole caller hardcoded a constant). It's now a typed `launch: PtyLaunchSpec` end to end - `TreqCommandRequest::PtyStart`/`PtyAttachCommand`, the CLI's `PtyLaunchPayload`, `pty_remote_supervisor::start_session`/`build_attach_command`, and the frontend's `remotePtyReattach`/`RemoteTerminalPanel` - reusing the same allow-listed `PtyLaunchSpec`/`RemoteAgentId` enums and `shell_quote`-per-field discipline `remote_pty_create` already enforced, via a new shared `remote_pty::build_launch_program` helper. A frontend caller can no longer construct a raw command string for this path at all. Covered by a new Rust test, `build_attach_command_quotes_malicious_agent_arguments_and_cannot_be_used_to_inject_shell_syntax`, written first (confirmed it would have caught the old unquoted-string version) then made to pass by the typed refactor.

### Phase 8: Full PTY streaming and reattach - desktop client (done: backend commands and UI both in place)

Brings desktop toward parity with the mobile PTY/reattach experience Phase 7 builds, now that the shared `pty-remote` VM-local supervisor (Phase 7, item 1) exists.

- **Done:** `core::remote_pty::RemotePtyManager::create` now delegates to a new `create_with_command(binding, endpoint, command: &str, cols, rows, on_output, on_exit)`, which opens a PTY channel with an already-built command line instead of assembling one from a `PtyLaunchSpec` - `create`'s existing callers are unaffected (it still builds a spec-derived command and delegates), and `create_with_command` is what reattach needs, since the command comes from the VM's `pty-remote attach-command` response rather than from a `PtyLaunchSpec` this process would build itself. Covered by a new test, `create_with_command_opens_a_pty_with_an_already_built_command_line`, against the module's existing mock echo SSH server.
- **Done:** two new Tauri commands in `commands/remote_pty_commands.rs` - `remote_pty_list_persistent_sessions` (a thin wrapper: `TreqCommandRequest::PtyList` needed no new plumbing at all beyond the existing generic `remote_dispatch_over_ssh`/`execute_remote_command` path, so this command exists mostly for callers that would rather not build that request by hand) and `remote_pty_reattach` (fetches the literal attach command via `TreqCommandRequest::PtyAttachCommand`, then opens a live PTY channel with it via `create_with_command`, emitting the same `remote-pty-data-<session_id>`/`remote-pty-exit-<session_id>` events `remote_pty_create` already does - a caller does not need a separate code path for "reattach" vs. "fresh session"). Both registered in `lib.rs`'s Tauri command list.
- **Done:** a desktop terminal UI wired to the commands above. `src/components/RemoteTerminalPanel.tsx` renders an xterm.js terminal against a live remote PTY (mirroring `ConsolidatedTerminal`'s fit-addon/resize-observer wiring but over the `remotePty*` IPC surface in `lib/api-extra.ts` instead of the local one); unmounting it is "Detach" (the VM-local `pty-remote` session keeps running, matching mobile's Detach semantics), and a "Stop" button additionally dispatches `PtyStop` to kill the remote session. `src/components/RemoteTerminalDialog.tsx` is the entry point: on open it calls `remote_pty_list_persistent_sessions` and offers "Reattach" against any already-running session or "Start new" with a fresh label, covering the originally-scoped "list running sessions and offer reattach" behavior. `Dashboard.tsx` wires a "Terminal" button into the existing remote-repo status bar (shown whenever `activeSshEndpoint` is connected), opening the dialog against the active repository's canonical path. `lib/api-extra.ts` gained `remotePtyListPersistentSessions`/`remotePtyReattach` wrappers over the two Phase 8 backend commands.
  **Fixed (post-audit):** the "Terminal" button lives in `Dashboard`'s repo-level status bar (`isRemoteActive`), which really is rendered above and independent of workspace selection - unlike mobile's Phase 7 entry point, which is always reached from a specific workspace's detail screen, so there is no single "the workspace" this button can assume. But `Dashboard` already tracks a `selectedWorkspace` (the workspace the user is currently viewing a session/review for, when there is one), and it stays populated across remote sessions the same way it does locally. The original PRD text characterized this as a UI structural gap requiring the `"root"` shortcut unconditionally; that overstated it; the shortcut was only genuinely required when no workspace happens to be selected yet (e.g. right after connecting, before opening any session) - the far more common case, once a workspace is open, already had the real workspace in scope and simply wasn't using it. `Dashboard.tsx` now resolves the terminal's target via a new `resolveRemoteTerminalTarget` helper (`src/lib/remote-terminal-target.ts`): when `selectedWorkspace` is set, it opens at that workspace's real `workspace_path` under its real `workspace_name` id; only when nothing is selected does it fall back to the repo root under the fixed `"root"` id, matching mobile's fallback shape. Covered by `src/lib/remote-terminal-target.test.ts`, written first against the bug (asserting a selected workspace's own path is used, confirmed red before the helper existed) before the fix. Not verified against a real SSH endpoint/VM in this environment (no live managed instance to connect to) - typechecks clean and the existing `remote-pty-api.test.ts` IPC-mapping tests still pass, but the xterm.js/live-PTY path itself has only been reviewed by eye against `ConsolidatedTerminal`'s established pattern, the same caveat Phase 7's mobile `TerminalScreen.tsx` carries for its own unverified-on-device WebView path.
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
