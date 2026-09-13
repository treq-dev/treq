# Treq Mobile (React Native)

Standalone React Native app for mobile remote control, replacing the earlier
Tauri-mobile-build approach (see `prds/mobile.md`). SSH connectivity is
implemented in Rust (`crates/treq-mobile-ssh`, built on `russh`) and exposed
to this app through a native module bridge, following the pattern in
https://rust-dd.com/post/building-a-rust-native-module-for-react-native-on-ios-and-android.

## Status

Real, generated native projects exist under `ios/` and `android/` (via
`npx @react-native-community/cli init`, then merged with this repo's own
bridge source), so the native module wrappers are no longer floating
source files with nothing to compile them:

- `ios/TreqMobile/TreqSshBridge.swift` + `.m` — wraps the UniFFI Swift
  bindings, seals the generated private key straight into iOS Keychain,
  exposes only an opaque `keyHandle` to JS, and is registered in the real
  Xcode project (`ios/TreqMobile.xcodeproj`)'s Sources build phase.
- `android/app/src/main/java/com/treq/mobile/TreqSshModule.kt` +
  `TreqSshPackage.kt` — wraps the UniFFI Kotlin bindings, seals the key
  with an Android Keystore-backed AES key, registered in
  `MainApplication.kt`'s package list. `android/app/build.gradle`'s
  `generateTreqMobileSshBindings` task runs `cargo build` +
  `uniffi-bindgen` from source before every Kotlin compile, so the bindings
  it compiles against are never a vendored, driftable copy.

Phase 3 (read-only review): `src/lib/treqCli.ts` mirrors desktop's
`TreqCommandRequest` CLI argv/response contract (`workspace list`,
`changes list`/`diff`, `commits list`, `conflicts list`, `file read`, all
`--format json`) and `WorkspacesScreen` -> `WorkspaceDetailScreen` ->
`DiffScreen`/`CommitsScreen`/`ConflictsScreen` drive it over a real SSH
exec channel, including parent/working-copy file context and
conflict-region detail on `DiffScreen`.

Phase 2's control-plane path is wired: `SignInScreen` (web sign-in,
completed automatically via the `treqmobile://sign-in?token=...` deep link
registered in both native projects, with manual token paste as a fallback)
and `ManagedConnectScreen` (find-or-provision the user's managed instance
via `listRegions`/`listSizePresets`/`ensureInstance`/`wakeInstance`, then
device-key generation -> `registerClientKey` -> `issueCertificate` ->
`TreqSsh.connectWithCertificate`) implement the managed-instance path.
Certificates renew silently ahead of expiry via `certRenewal.ts`
(`CertificateRenewalManager`, ported from desktop's
`remote-cert-lifecycle.ts` - see that file's module doc for why it's
ported rather than imported).

`ConnectScreen` still takes a raw `username@host:port#fingerprint`
connection string (`src/lib/parseConnectionString.ts`) as a deliberately
temporary stand-in for registered endpoints on the user-managed (as
opposed to managed-instance) path.

## What's tested

- `crates/treq-mobile-ssh/src/lib.rs` (`cargo test -p treq-mobile-ssh`,
  CI job `rust`): device key generation produces a valid ed25519 key;
  `connect` rejects a mismatched host-key fingerprint; a full connect +
  exec round trip against a real (in-process, mock) SSH server, then a
  rejected exec on a disconnected session; a full `connect_with_certificate`
  round trip using a real, freshly-signed OpenSSH user certificate (a
  throwaway in-test CA, not the control plane's signing service, but a
  real certificate parsed and presented over a real SSH session via
  `authenticate_openssh_cert`), plus a malformed-certificate rejection
  case. Same in-process-mock-server pattern
  `src-tauri/src/core/remote_ssh_transport.rs`'s own tests use.
- `mobile/src/screens/__tests__/*.test.tsx` + `mobile/src/lib/__tests__/*.test.ts`
  (`npm test`, CI job `rn-checks`): every screen and lib module against a
  mocked `TreqSsh` native module (`jest.setup.js`) and a mocked Supabase
  client - component/unit-level coverage of rendering, state, navigation,
  the control-plane request/response contract, and the certificate-renewal
  scheduling algorithm (13 ported test cases in `certRenewal.test.ts`,
  covering transparent renewal, session-ended/key-revoked/
  instance-inaccessible cutoffs, retry-then-renew, and lapse-past-expiry).
- `mobile/src/screens/__tests__/*.real.test.tsx` (`npm run test:real`,
  CI job `rn-real-ssh`): the **same screens**, driven the same way
  (`@testing-library/react-native`'s `render`/`fireEvent`/`waitFor`), but
  with `TreqSsh` backed by `src/native/TreqSsh.real.ts` - a thin JS shim
  over a real N-API build of `treq-mobile-ssh` (feature `napi`,
  `npm run build:native-test`) instead of a mock. Opens real TCP
  connections and runs real SSH exec channels against a real
  `mock_ssh_server` process returning realistic Phase 3 fixture JSON, so
  the screens' real JSON parsing (`treqCli.ts`) is exercised too. It
  substitutes a Node-hosted shim for the Swift/Kotlin marshalling layer,
  which Jest (a Node process) cannot execute - see the next two jobs.
- `crates/treq-mobile-ssh/ffi-tests/{kotlin,swift}` (CI jobs `kotlin-ffi`,
  `swift-ffi`): real Kotlin (JVM + JNA) and real Swift programs, calling
  the real UniFFI-generated bindings against a real `mock_ssh_server`
  process on each language's real toolchain - including
  `connectWithCertificate`, using a real certificate obtained by shelling
  out to `mock_ssh_server sign-cert <public_key>` (neither language has
  its own certificate-building library).
- `android-build` (CI job): the *real* `TreqSshModule.kt`/`TreqSshPackage.kt`
  compiled by `./gradlew :app:compileDebugKotlin` against the real React
  Native Android artifact in the real generated Gradle project, with
  UniFFI Kotlin bindings generated from source first. Verified locally in
  this sandbox by installing an Android SDK (`cmdline-tools`,
  `platforms;android-35`, `build-tools;35.0.0`) and running the same
  command - `BUILD SUCCESSFUL`, zero errors.
- `ios-build` (CI job, `macos-14`): `pod install` + `xcodebuild build`
  against the real generated Xcode project, including
  `TreqSshBridge.swift`/`.m` (added to the project's Sources build phase
  by hand-editing `project.pbxproj`, since the RN CLI scaffold has no
  knowledge of them). **Not verified locally** - this sandbox has no
  macOS/Xcode, only the pbxproj edit's brace-balance and the Info.plist's
  XML validity were checked here; first real verification is that CI job.

## What's still not verified

- The `ios-build` CI job itself has never actually run (no macOS available
  in this development sandbox to dry-run it) - only locally checkable
  proxies (pbxproj structural validity, Info.plist XML validity) were
  verified. `android-build`'s equivalent, `compileDebugKotlin`, *was* run
  locally and passed.
- A full linked APK/IPA: `android-build` stops at Kotlin/Java compilation
  (no Android NDK here to build React Native's own native C++ libraries
  via CMake for `jniLibs`, confirmed by a `configureCMakeDebug[arm64-v8a]`
  failure when a full `assembleDebug` was attempted locally - a real,
  expected gap, not a bug in this app's own code). Building the actual
  per-ABI `libtreq_mobile_ssh.so` files (via `cargo ndk`) for a real device
  to load at runtime is also not done.
- The control-plane client (`controlPlane.ts`, `authStore.ts`,
  `certRenewal.ts`) against a live Supabase stack: still mocked-client-only
  in this sandbox, since bringing up the local Supabase CLI stack needs a
  reachable Docker daemon, and this sandbox's Docker socket isn't
  reachable (`docker info` fails). Not a design gap, an environment one -
  see `scripts/service-qa/up.sh` for what a real attempt looks like
  elsewhere.
- Real device/simulator execution of anything above.

## Building the Rust side

```sh
cd crates/treq-mobile-ssh
cargo build --target aarch64-apple-ios          # iOS device
cargo build --target aarch64-linux-android        # Android arm64
cargo run --bin uniffi-bindgen generate --library target/debug/libtreq_mobile_ssh.dylib --language swift --out-dir bindings/swift
cargo run --bin uniffi-bindgen generate --library target/debug/libtreq_mobile_ssh.so --language kotlin --out-dir bindings/kotlin
```

`android/app/build.gradle` does the Kotlin half of this automatically
(`generateTreqMobileSshBindings`, run before every Kotlin compile) using
the host-target `.so` - real per-ABI Android `.so` files for a device
still need the `cargo build --target aarch64-linux-android` step above via
`cargo ndk`, which this repo does not yet script.

## Running the app

```sh
npm install
npm run ios       # or: npm run android
```
