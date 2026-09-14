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

**Architecture note:** Phases 1-2 below were originally delivered as a Tauri build compiled for Android/iOS (`MobileShell`, `tauri:android`/`tauri:ios` targets, `core::remote_device_key` using `tauri-plugin-keystore`/`tauri-plugin-biometric`). That path has been removed. Mobile is now a standalone React Native app under `mobile/`, backed by a dedicated Rust SSH crate (`crates/treq-mobile-ssh`, `russh` + UniFFI) called through a native module bridge (Swift/Kotlin), per the pattern in https://rust-dd.com/post/building-a-rust-native-module-for-react-native-on-ios-and-android. The phase numbering and scope below are unchanged; what changed is which files implement each phase. Statuses reflect the RN implementation, not the removed Tauri one.

### Phase 1: Build system and mobile shell (superseded, redone)

Original scope (Tauri build targets, mobile capability file, `MobileShell` layout switching on viewport) no longer applies. Redone as:

- `mobile/` - a standalone React Native + TypeScript app (`package.json`, `App.tsx`, `@react-navigation/native-stack` navigator).
- `crates/treq-mobile-ssh` - a `cdylib`/`staticlib` Rust crate exposing SSH operations via a UniFFI interface (`treq_mobile_ssh.udl`), instead of Tauri IPC commands.
- Two screens (`ConnectScreen`, `WorkspacesScreen`) rather than a single `MobileShell` - React Native has no equivalent of switching a shared desktop component tree by viewport, since it is not the same codebase as the desktop app.

Done. No further work planned under this phase; see Phase 2 below for the connectivity layer this shell now calls into.

### Phase 2: Security and connectivity prototype (control-plane path now wired)

Done:

- Generate a per-device ed25519 keypair and its OpenSSH public key/fingerprint, in real Rust (`SshClient::generate_device_key` in `crates/treq-mobile-ssh/src/lib.rs`).
- Store that private key in OS-native secure storage rather than crossing to JS: iOS Keychain (`mobile/ios/TreqMobile/TreqSshBridge.swift`) and an Android Keystore-backed AES-sealed blob (`mobile/android/app/src/main/java/com/treq/mobile/TreqSshModule.kt`). Only an opaque `keyHandle` crosses the native-module boundary to JS - the private key itself never does.
- Verify a pinned host-key fingerprint and connect with the native (russh) SSH library before any credentials are sent (`SshClient::connect`, `HostKeyVerifier`), rejecting a mismatched fingerprint.
- Authenticate with a short-lived OpenSSH user certificate instead of direct public-key auth (`SshClient::connect_with_certificate`, mirroring desktop's `authenticate_openssh_cert`), for the managed-instance path - verified with a real self-signed test certificate against a real SSH session (`connect_with_certificate_round_trips_through_a_real_ssh_session` in `crates/treq-mobile-ssh/src/lib.rs`).
- Execute commands over a real SSH exec channel and read back stdout/stderr/exit status (`SshClient::exec_command`).
- Supabase auth: sign in via the same web sign-in page desktop uses, exchanged for a session via the same `exchange-desktop-token` edge function (`mobile/src/lib/authStore.ts`, `controlPlane.ts`).
- Device-key registration and certificate issuance against the real `remote-ssh-trust` edge function (`registerClientKey`/`issueCertificate` in `controlPlane.ts`, request/response types imported directly from `src/lib/api-types-remote.ts` rather than duplicated) - `ManagedConnectScreen` drives generate-key -> register -> issue-certificate -> `connectWithCertificate` end to end, using the certificate response's own trusted host-key fingerprint rather than a manually pinned one.
- Managed-instance provisioning, status, and wake against the real `remote-instance` edge function (`listRegions`/`listSizePresets`/`getInstanceStatus`/`ensureInstance`/`wakeInstance` in `controlPlane.ts`) - `ManagedConnectScreen` finds or provisions the user's single managed instance rather than requiring a known `instance_id`, polling while it's in a transient state (provisioning/bootstrapping/waking/etc).
- Silent certificate renewal ahead of expiry while the session stays valid, and a hard cutoff (session disconnect) when renewal is refused - `mobile/src/lib/certRenewal.ts`'s `CertificateRenewalManager`, ported from desktop's `remote-cert-lifecycle.ts` (same algorithm and 13 ported test cases; see that file's module doc for why ported rather than imported - the desktop file pulls in Tauri-specific wiring at module scope).
- Sign-in via a real `treqmobile://sign-in?token=...` deep link, registered in both native projects (Android intent-filter, iOS `CFBundleURLTypes`) and caught by `Linking.addEventListener` (`authStore.ts`'s `listenForSignInDeepLink`), with manual token paste kept as a fallback for contexts with no real native runtime to fire the event through (this repo's own tests included).
- A connect UI (`ConnectScreen`): generate/regenerate the device key, and a temporary `username@host:port#fingerprint` connection-string field (`parseConnectionString.ts`) standing in for registered-endpoint selection on the user-managed path; `SignInScreen` + `ManagedConnectScreen` for the managed path.
- Real `ios/` and `android/` native projects (via `npx @react-native-community/cli init`, merged with this repo's existing bridge source) - `TreqSshModule.kt`/`TreqSshPackage.kt` are registered in `MainApplication.kt` and verified to compile for real against the real React Native Android artifact (`./gradlew :app:compileDebugKotlin`, `BUILD SUCCESSFUL`, run locally in this delivery); `TreqSshBridge.swift`/`.m` are added to the real Xcode project's Sources build phase (hand-edited `project.pbxproj`, since the RN CLI scaffold doesn't know about pre-existing bridge files) but not locally build-verified (no macOS available) - see `.github/workflows/mobile.yml`'s new `android-build`/`ios-build` jobs.
- Certificate auth (`connectWithCertificate`) exercised from real Kotlin and Swift, not just Rust: both FFI test programs shell out to a new `mock_ssh_server sign-cert <public_key>` subcommand (`mock_server::sign_test_certificate`) for a real signed certificate, since neither language has its own certificate-building library.

Open items before this is more than a prototype:

- The `ios-build` CI job (`pod install` + `xcodebuild build` against the real Xcode project) has not actually been run anywhere yet - this development sandbox has no macOS/Xcode, so only locally-checkable proxies (pbxproj brace-balance, Info.plist XML validity) were verified before committing. `android-build`'s equivalent (a full `assembleDebug`) *was* run locally and passed, producing a real linked APK.
- No full linked iOS IPA: `TreqSshBridge.swift` needs the UniFFI Swift bindings packaged as a real XCFramework for iOS targets, which this repo does not yet script (see `mobile/README.md`'s "Building the Rust side").

Closed since the last pass: a full linked Android APK, with New Architecture on (`newArchEnabled=true`, the RN 0.76 default), plus a production build. Installed the Android NDK (`ndk;26.1.10909125`), `cargo-ndk`, and the Android Rust targets, and added `android/app/build.gradle`'s `buildTreqMobileSshNativeLibs` task (`cargo ndk build --release` across all four ABIs, wired into `preBuild`) so `assembleDebug`/`assembleRelease`/`bundleRelease` link the real `libtreq_mobile_ssh.so` into `jniLibs` alongside React Native's own native libraries - verified by unzipping the resulting APKs and confirming `lib/<abi>/libtreq_mobile_ssh.so` for all four ABIs, under both New Architecture (Fabric/TurboModules, `react-native-screens`'s generated `react_codegen_*` C++ included) and a real R8-minified `assembleRelease`/`bundleRelease`. Getting a debug build working needed pinning AGP to 8.7.2 in `android/build.gradle` (the previously-unversioned dependency resolved to 8.6.0 via the React Native Gradle plugin, which has a real bug failing `configureCMakeDebug` for any autolinked native module - `react-native-screens` here - with `[CXX1210] No compatible library found`, even though the underlying `prefab` CLI call it logs succeeds when run by hand; New Architecture was briefly disabled while narrowing this down, since screens' own CMake build is skipped when it's off, but 8.7.2 fixes the actual bug so New Architecture is back on). The production build needed one more fix: `@react-native/metro-config` was missing from `package.json`'s devDependencies entirely (harmless for debug, since Metro normally runs via the dev server, but `assembleRelease`'s JS-bundling task needs it and failed without it). Real per-device production download size (via `bundletool build-apks`/`get-size total` against the release `.aab`, the Play-Store-accurate number rather than the 71MB fat universal APK) is **~11.2-12.8MB** depending on ABI - see `mobile/README.md`'s "Production build" note for the full breakdown.
- No UI for the "biometrics not set up" / secure-storage-unavailable case.

Closed since the last pass: the control-plane client (`controlPlane.ts`, `authStore.ts`, `certRenewal.ts`) is now exercised against a real local Supabase CLI stack, not just a mocked client - `scripts/service-qa/specs/mobile-control-plane.spec.ts` (`npm run service-qa:up && npm run service-qa`). Doing so surfaced and fixed a real cross-client bug: `remote-instance`'s `status`/`ensure`/`wake`/`reprovision` responses were serializing the raw DB row's `id` column where both desktop's (`remote_provider.rs`) and mobile's (`api-types-remote.ts`) `ManagedInstanceRecord` type expect `instance_id` - no mocked test had ever hit the real wire shape to catch it. See `mobile/README.md`'s "Control-plane client against a live Supabase stack" section for the fix.

### Phase 3: Read-only review (in progress)

Original scope described a `TreqCommandRequest` JSON protocol dispatched from desktop's `remote_dispatch_over_ssh`. Mobile does not call into that desktop command surface (it has no Tauri IPC); instead it runs the same underlying `treq <command> --format=json` CLI invocations directly over its own SSH exec channel (`SshClient::exec_command`), parsing the same JSON response shapes.

Status: see the implementation delivered alongside this PRD update for what's built. Tracking here as "in progress" rather than done until it has real workspace/diff/commit/conflict screens exercised against a live `treq` CLI (real or fixture), not just the free-text command runner `WorkspacesScreen` originally shipped with.

Not done regardless of the above: parent-revision file context as a separate screen, a dedicated commit-diff view, and per-commit conflict detail beyond a flat list - all deferred past this pass.

### Phase 4: Agent control (done)

`mobile/src/screens/AgentScreen.tsx` starts, inspects, sends input to, and stops a remote coding agent by running the same `agent-remote start`/`input`/`status`/`stop`/`logs` CLI invocations desktop's `core::agent_supervisor` backs, over mobile's own SSH exec channel (`mobile/src/lib/treqCli.ts`'s `agentStartArgv`/`agentInputArgv`/`agentStatusArgv`/`agentStopArgv`/`agentLogsArgv`, `parseAgentStatus`, `parseAgentLogs`). `WorkspaceDetailScreen` links into it alongside Commits/Conflicts. The screen polls `agent-remote status` (and, while running, `agent-remote logs`) every 4 seconds rather than holding an interactive PTY, per the PRD's "Terminal UX" note that structured agent control comes before a terminal.

Not done: push notifications for agent events, and reattaching an agent session across an app restart beyond what a fresh `agent-remote status` poll already provides for free (the VM-local record survives; the mobile UI does not yet persist which workspace's agent screen was last open).

### Phase 5: Controlled mutations (partial)

Wired, each carrying a caller-generated idempotency key (`generateIdempotencyKey` in `controlPlane.ts`) so a retry after a dropped connection replays rather than double-applies, mirroring `core::remote`'s `with_idempotency_key`:

- Workspace creation (`WorkspacesScreen`'s "New workspace" form) and rebase (`WorkspaceDetailScreen`'s "Rebase" modal), both with explicit confirmation before dispatch.
- Commit creation (`CommitsScreen`'s "New commit" form).
- Conflict resolution (`CommitsScreen`'s per-commit "Resolve" action, confirmed via alert) - resolves by change id (the same commit `changeId` `commits list` already reports as `hasConflicts`), using the CLI's default resolution since mobile has no per-side conflict editor yet.
- Bookmark push with explicit confirmation (`WorkspaceDetailScreen`'s "Push" button).

Closed since the last pass: per-side conflict resolution - `CommitsScreen`'s "Resolve" action now offers `left`/`right`/`base` explicitly alongside the CLI's default, rather than only ever taking the default (`resolveConflictArgv`'s `sides` parameter, already plumbed, was previously always called with `[]`).

Not done: patch application. `patchFileArgv` (`treqCli.ts`) plumbs the CLI call (`file patch --value <base64>`), but there is no mobile diff-editing UI to produce a patch from, so nothing calls it yet - deferred past this pass.

### Phase 6: Mobile test infrastructure (partial)

- Real control-plane test project - done: `scripts/service-qa/specs/mobile-control-plane.spec.ts` exercises `controlPlane.ts`'s exact request/response shapes against a real local Supabase CLI stack (`npm run service-qa:up && npm run service-qa`), not a mocked client.
- Real provider test instances - not mobile-specific work: `remote-instance`'s provisioning path is shared with desktop and already runs against `StubSpritesProvider` in service-qa (`REMOTE_SPRITES_STUB=1`); a real Fly Sprites account in CI is tracked under [Remote SSH Control](./remote-ssh.md), not here.
- Device key and certificate issuance tests - done: `generates_a_valid_ed25519_device_key` and `connect_with_certificate_round_trips_through_a_real_ssh_session` (`crates/treq-mobile-ssh/src/lib.rs`), plus `registerClientKey`/`issueCertificate` coverage in `controlPlane.test.ts`.
- Host-key mismatch and rotation tests - done: `connect_rejects_mismatched_host_key_fingerprint` (a fabricated wrong fingerprint) and `connect_rejects_a_rotated_host_key_then_succeeds_once_repinned` (a real second mock server with a genuinely different host key, rejected under the stale pinned fingerprint, then accepted once re-pinned) in `crates/treq-mobile-ssh/src/lib.rs`.
- Network transition and app suspension tests - done: `certRenewal.test.ts` covers transient-failure retry-then-renew and an already-late renewal never scheduling a negative delay (the shape of a network blip), plus `CertificateRenewalManager.onAppForeground()` (re-anchors the renewal timer to the current clock rather than trusting a `setTimeout` delay computed before the app was suspended - a stale mobile timer can fire very late, or not survive at all if the process was killed and relaunched) and its no-op-after-`stop()` case. `ManagedConnectScreen` wires this to a real `AppState` "active" listener.
- Idempotent mutation retry tests - done: `mobile/src/lib/mutationRetry.ts`'s `runMutationWithRetry` retries a transport-level failure (a thrown exec error, e.g. a dropped SSH session) with the *same* argv - and therefore the same idempotency key - rather than generating a new one, so a mutation that landed on the VM just before the drop is not double-applied when the retry lands too (`with_idempotency_key` in `core::remote` de-dupes by key regardless of how many times it arrives). Does not retry a completed exec with a non-zero exit status (a structured CLI error, not a dropped connection). Wired into every idempotency-keyed mutation call site (`WorkspacesScreen`, `WorkspaceDetailScreen`, `CommitsScreen`, `AgentScreen`) and covered by `mutationRetry.test.ts`. This is deliberately simpler than desktop's `retry_after_reconnect` (`core::remote`), which does a post-reconnect state-verification read before deciding to retry at all - mobile always retries transport failures rather than first checking whether the mutation already landed, since it has no typed read-and-compare recipe per mutation kind yet.
- Resource cleanup and cost controls - done: `controlPlane.ts`'s `deleteInstance` mirrors desktop's tear-down call against `remote-instance`'s `delete` action, which enforces the same per-user quota (`BASE_ALLOCATION`, `QuotaExceededError`) and ownership checks as `ensure`; covered in `controlPlane.test.ts`. `ManagedConnectScreen` now has a confirmed "Delete instance" entry point wired to it.

### Phase 7: Full PTY streaming and reattach - mobile client (done: items 1-2 solid and tested; item 3 partial, unverified on-device)

Scope: give mobile a real interactive terminal over the SSH connection - live bidirectional byte streaming, resize, and the ability to detach (leave the remote process running) and later reattach to that same session - superseding polling for anything that needs true interactivity (raw agent TUIs, ad hoc shell use). `AgentScreen`'s `agent-remote status`/`logs` polling loop (Phase 4) stays as the lighter-weight structured path for agents that don't need a live terminal; this phase adds the PTY path alongside it, it does not replace it.

**1. VM-local persistent PTY supervisor - done.** `core::pty_remote_supervisor` (`src-tauri/src/core/pty_remote_supervisor.rs`) implements the `pty-remote` CLI surface as a new subcommand alongside `agent-remote` (`start`/`list`/`stop`/`attach-command`, wired through `tauri.conf.json`'s CLI schema and `cli::mod::parse_remote_command_request`/`handle_cli_command`, and four new `TreqCommandRequest` variants - `PtyStart`/`PtyList`/`PtyStop`/`PtyAttachCommand` - following `agent-remote`'s existing `is_mutation`/`requires_idempotency_key`/`kind_name`/`KIND_NAMES`/`cli_args`/`execute_local_request` pattern exactly, including the TypeScript `TREQ_COMMAND_KINDS` mirror in `src/lib/remote-dispatch.ts`).

  Implementation decision (resolves the open question below): **tmux-backed, with `screen` as a fallback**, not a custom fork+setsid+pty+ring-buffer supervisor - documented in the module's doc comment. A session is a single detached `tmux`/`screen` session named `treq-pty-<workspace>-<label>`; `start`/`list`/`stop` shell out to `tmux new-session -d`/`list-sessions`/`kill-session` (or the `screen` equivalents); `build_attach_command` returns the literal command line an SSH PTY channel execs - `cd <dir> && exec tmux new-session -A -s <name> ...` - mirroring `core::remote_pty::build_launch_command`'s shape and quoting discipline (`shell_quote` on every dynamic component). `tmux new-session -A` ("attach if it exists, else create") makes one command line cover both first-start and reattach, so a caller never needs to know in advance which case applies. Resize does not need its own wire message on the hot path: tmux/screen auto-resize to the attached client's window on the SSH channel's own `window_change_request`; `resize_session` exists for the pre-attach case. The accepted trade-off: this depends on `tmux` or `screen` being installed on the remote host, and fails with a clear `dependency_error` (not a silent non-persistent fallback) when neither is present - acceptable for Treq's managed-instance provisioning path, an open risk for arbitrary user-managed endpoints (noted in Open Questions below, no longer entirely open: the decision is "depend on it, fail loudly," not "always degrade silently").

  Tested with 6 real tests in `pty_remote_supervisor::tests` run against a live local `tmux` server (not mocked): `session_name_sanitizes_unsafe_characters`, `parse_session_name_round_trips_through_session_name`, `build_attach_command_quotes_a_malicious_working_directory`, `build_attach_command_errors_clearly_when_no_backend_detected`, `start_list_stop_lifecycle_round_trips_against_a_real_tmux_server` (start is idempotent, list finds it, stop removes it, stop is idempotent), `attach_command_reattaches_to_an_existing_session_without_recreating_it`.

**2. Rust SSH crate (`crates/treq-mobile-ssh`) PTY channel primitives - done and tested.** `SshClient` gained `open_pty(session_id, term, cols, rows, command) -> ptyId`, `pty_write(ptyId, data)`, `pty_resize(ptyId, cols, rows)`, `poll_pty_events(ptyId, timeout_ms, max_events) -> [PtyEvent]`, `close_pty(ptyId)`, exposed through the UniFFI UDL interface (`treq_mobile_ssh.udl`'s new `PtyEvent` enum - `Data`/`ExitStatus`/`Closed` - and the six new `SshClient` methods).

  **Spike result on the event-stream open question**: UniFFI's async callback interfaces are not practical at this crate's `uniffi = "0.28"` UDL-scaffolding version (`uniffi::include_scaffolding!`, not the proc-macro `uniffi::*` attribute path) - that support exists only on the proc-macro path, and migrating this whole crate to it is a separate, larger change (it touches every existing method's generated bindings and the Kotlin/Swift FFI test programs in `ffi-tests/`). Decision: **bounded polling read-buffer**, documented in `poll_pty_events`'s doc comment. A background reader task per open PTY drains channel messages into a `VecDeque<PtyEvent>` capped at `MAX_BUFFERED_PTY_EVENTS` (4096, oldest dropped first, mirroring desktop's `MAX_BUFFERED_OUTPUT_BYTES` backstop); `poll_pty_events` drains up to `max_events`, blocking up to `timeout_ms` via a `tokio::sync::Notify` if none are yet ready.

  One real implementation bug was found and fixed via a test that actually hung rather than one that would have silently passed: an early version shared one `Channel` behind one lock between the reader task (which holds `wait()` for the channel's entire lifetime) and writes (`pty_write`/`pty_resize`), which deadlocks - a blocked write can never be serviced by a reader that only releases its lock between messages. Fixed by splitting the channel into `ChannelReadHalf` (owned exclusively by the reader task) and an `Arc<ChannelWriteHalf<_>>` (writes take `&self`, so no lock is needed for them at all).

  `mock_ssh_server`'s `MockHandler` gained `pty_request`/`window_change_request` handling (both just `channel_success`), plus a `pty-echo:<label>` exec-command fixture that stays open and echoes interactively (rather than the plain-exec fixture's respond-once-and-close), backed by a `pty_backlogs: Arc<Mutex<HashMap<String, Vec<u8>>>>` shared across every connection the mock server accepts - simulating a real tmux/screen session's scrollback surviving a detach/reconnect independent of any one SSH connection.

  8 real tests pass in `treq-mobile-ssh`'s own suite (up from 6 before this phase): the two new are `open_pty_write_and_poll_round_trip_through_a_real_ssh_session` (open/write/resize/poll/exit-observation/close, idempotent close) and `reattach_replays_backlog_from_a_prior_session` - opens a PTY, writes, waits for the echo, closes the PTY and disconnects the whole SSH session (simulating an app relaunch), reconnects, opens a *new* PTY against the same backend label, and asserts the prior session's output is replayed before any new write - the actual reattach-survives-detach guarantee, not just that the API compiles.

**3. Native module bridge + mobile UI - partial, mostly unverified on-device.**

  - `mobile/src/lib/ptyRemoteCli.ts` (a sibling module to `treqCli.ts`, not an extension of it, since `attach` is not a JSON request/response call): argv builders/parsers for `pty-remote start`/`list`/`stop`/`attach-command`, using a small JSON `--value` payload (`{remote_dir, command, cols, rows}`) matching Rust's `PtyLaunchPayload`/`parse_pty_launch_payload`. 7 tests pass in `ptyRemoteCli.test.ts`.
  - `mobile/src/native/TreqSsh.ts` gained the typed surface (`openPty`/`ptyWrite`/`ptyResize`/`closePty`/`startPtyEventStream`/`stopPtyEventStream`, plus a `PtyEventPayload` union for the `TreqSshPtyEvent` `NativeEventEmitter` event, PTY output crossing as base64 since it is arbitrary binary, not UTF-8 text).
  - `TreqSshBridge.swift` and `TreqSshModule.kt` gained the corresponding methods, including a background poll-and-emit loop (native-bridge half of the polling decision above) - **written to the same generated-bindings shape as the existing methods, but not built or run**: this environment has no macOS or Android SDK/toolchain (the same constraint the Phase 2 write-up notes for this file's original methods), so these are unverified beyond compiling by eye against the UniFFI Swift/Kotlin codegen shape and should be built and exercised by hand (or in CI's kotlin-ffi/swift-ffi jobs) before shipping.
  - `TerminalScreen.tsx`: renders a WebView hosting `xterm.js` (loaded from a CDN, not yet a bundled/offline asset - see the file's doc comment), forwards keystrokes via `postMessage`/`onData`, exposes "Detach" (closes only the local channel/screen; the remote `pty-remote` session keeps running) as a visually distinct action from "Stop" (calls `pty-remote stop`, ending the remote process), and auto-reattaches on `AppState` foreground, reusing the same listener pattern `certRenewal.ts`/`ManagedConnectScreen` established. **Terminal-emulation decision** (resolves the open question below): WebView + `xterm.js`, chosen for real ANSI/VT100 handling (cursor movement, colors, alt-screen apps like `vim`/`less`) without hand-rolling a terminal emulator - accepted trade-off is a network dependency for the CDN-loaded script and a JS bridge round-trip per keystroke/output chunk. **Not verified against a running WebView** - no device or simulator available in this environment; there is no dedicated `TerminalScreen` test (mocking `WebView` + `NativeEventEmitter` + the native bridge realistically was out of scope for this pass).
  - `WorkspaceDetailScreen` gained a "Terminal" entry point that calls `pty-remote list` for the workspace and, when a session is already running, offers "Reattach" vs. "Start new" (a fresh label) rather than only ever starting fresh - covering the acceptance criterion's relaunch/reconnect case. Known simplification, not yet fixed: it opens the shell in the *repo* root, not the workspace's own checkout directory, since mobile has no `workspace inspect`-derived path lookup wired into this screen yet.
  - `AgentScreen` was **not** wired to `pty-remote list`/reattach in this pass - it remains exactly the Phase 4 polling loop described earlier in this document. Only `WorkspaceDetailScreen` got the new entry point.
  - Not done: a `mutationRetry.ts`-style retry wrapper specifically around PTY attach/reattach calls (the PRD's original plan). `pty-remote attach-command`/`open_pty`'s idempotent-reattach behavior (tmux `-A`) means a bare retry is already safe without needing `mutationRetry.ts`'s idempotency-key bookkeeping, so this was consciously simplified rather than left as a gap - but no explicit retry-on-transient-failure wrapper exists yet for the PTY channel itself the way `runMutationWithRetry` gives JSON mutations.

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

- Which native SSH library meets the certificate, host verification, PTY, and platform-security requirements?
- Can hardware-backed keys be used directly by the chosen SSH library on both mobile platforms?
- Which agent interactions require push notifications?
- Which mutations are safe and ergonomic enough for the first mobile release?
- What terminal functionality is necessary beyond structured agent control?
- ~~`tmux`/`screen`-backed persistent PTY vs. a custom Treq-owned supervisor process for reattach~~ - resolved by implementation: `core::pty_remote_supervisor` picks tmux (screen fallback), failing loudly with `dependency_error` when neither is installed rather than silently degrading. Still genuinely open: whether Treq's managed-instance provisioning should be changed to *guarantee* tmux is present (it isn't guaranteed today), and what a user-managed endpoint without either should be told beyond the error message.
- ~~Can UniFFI's async callback interfaces push PTY output events efficiently across the Rust/Kotlin/Swift boundary~~ - resolved by a real spike, documented in `crates/treq-mobile-ssh/src/lib.rs`'s `poll_pty_events` doc comment: not practical at this crate's UDL-scaffolding UniFFI version (`uniffi = "0.28"` via `include_scaffolding!`, not the proc-macro path where async callback interfaces exist). Implemented as a bounded polling read buffer instead. Still open: whether migrating the whole crate to UniFFI's proc-macro API later would be worth the churn to get a pushed callback (lower latency, less battery from polling) - not attempted here.
- ~~What terminal-emulation approach renders ANSI control sequences acceptably inside React Native~~ - resolved by implementation: WebView + `xterm.js` (loaded from a CDN). Still open: whether to bundle `xterm.js` as an offline asset instead of a CDN load, and whether the WebView bridge's per-keystroke JS round-trip is fast enough under real typing load - neither was measured (no device/simulator available in this environment).
- How much output backlog should a reattach replay by default, and should that be configurable per session or fixed? Still open - `pty_remote_supervisor` relies on tmux/screen's own scrollback (whatever size that is configured to, not something Treq controls), it does not implement its own backlog cap.
- Should concurrent multi-attach (two clients, e.g. mobile and desktop, attached to the same remote PTY at once) be supported from the start, or restricted to one attacher at a time initially even though the underlying `tmux`/`screen` primitive allows more?
