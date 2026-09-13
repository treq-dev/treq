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

Not done: patch application. `patchFileArgv` (`treqCli.ts`) plumbs the CLI call (`file patch --value <base64>`), but there is no mobile diff-editing UI to produce a patch from, so nothing calls it yet - deferred past this pass along with per-side conflict resolution (picking `left`/`right`/`base` explicitly rather than always taking the CLI default).

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
