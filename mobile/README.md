# Treq Mobile (React Native)

Standalone React Native app for mobile remote control, replacing the earlier
Tauri-mobile-build approach (see `prds/mobile.md`). SSH connectivity is
implemented in Rust (`crates/treq-mobile-ssh`, built on `russh`) and exposed
to this app through a native module bridge, following the pattern in
https://rust-dd.com/post/building-a-rust-native-module-for-react-native-on-ios-and-android.

## Status

Scaffold milestone: navigation, a manual connect screen, the JS-side native
module interface (`src/native/TreqSsh.ts`), and native bridge source files
for both platforms exist:

- `ios/TreqMobile/TreqSshBridge.swift` + `.m` — wraps the UniFFI Swift
  bindings, seals the generated private key straight into iOS Keychain, and
  exposes only an opaque `keyHandle` to JS.
- `android/native/kotlin/TreqSshModule.kt` + `TreqSshPackage.kt` — wraps the
  UniFFI Kotlin bindings, seals the key with an Android Keystore-backed AES
  key before storing the ciphertext, same `keyHandle`-only contract.

All of the above is now verified in CI (`.github/workflows/mobile.yml`) at
several different layers - see "What's tested" below for exactly which
layer each job/test covers, and "What's still not verified" for the one
gap none of them close: the bridge *wrapper* files themselves
(`TreqSshBridge.swift`/`.m`, `TreqSshModule.kt`) compiling and running as
real React Native native modules, which needs a generated Xcode/Gradle
project this repo does not have yet.

Phase 3 (read-only review) is in progress: `src/lib/treqCli.ts` mirrors
desktop's `TreqCommandRequest` CLI argv/response contract
(`workspace list`, `changes list`/`diff`, `commits list`, `conflicts list`,
`file read`, all `--format json`) and `WorkspacesScreen` ->
`WorkspaceDetailScreen` -> `DiffScreen`/`CommitsScreen`/`ConflictsScreen`
drive it over a real SSH exec channel, including parent/working-copy file
context and conflict-region detail on `DiffScreen`. `ConnectScreen` still
takes a raw `username@host:port#fingerprint` connection string
(`src/lib/parseConnectionString.ts`) as a deliberately temporary stand-in
for registered endpoints on the user-managed path.

Phase 2's control-plane path is now wired: `SignInScreen` (web sign-in +
pasted token, real Supabase session via `authStore.ts`) and
`ManagedConnectScreen` (device-key generation -> `registerClientKey` ->
`issueCertificate` -> `TreqSsh.connectWithCertificate`, all real calls
against the `remote-ssh-trust` edge function and a real certificate-signed
SSH session) implement the managed-instance path prds/mobile.md describes.
See prds/mobile.md's Phase 2/3 sections for what's still missing (deep-link
sign-in, instance provisioning/listing, silent certificate renewal,
commit-diff and per-commit-conflict CLI commands that don't exist in the
remote protocol yet).

## What's tested

- `crates/treq-mobile-ssh/src/lib.rs` (`cargo test -p treq-mobile-ssh`,
  CI job `rust`): device key generation produces a valid ed25519 key;
  `connect` rejects a mismatched host-key fingerprint; a full connect +
  exec round trip against a real (in-process, mock) SSH server, then a
  rejected exec on a disconnected session; a full
  `connect_with_certificate` round trip using a real, freshly-signed
  OpenSSH user certificate (a throwaway in-test CA, not the control
  plane's signing service, but a real certificate parsed and presented
  over a real SSH session via `authenticate_openssh_cert`), plus a
  malformed-certificate rejection case. Same in-process-mock-server
  pattern `src-tauri/src/core/remote_ssh_transport.rs`'s own tests use.
- `mobile/src/screens/__tests__/*.test.tsx` (`npm test`, CI job
  `rn-checks`): all screens (`ConnectScreen`, `WorkspacesScreen`,
  `WorkspaceDetailScreen`, `DiffScreen`, `CommitsScreen`,
  `ConflictsScreen`, `SignInScreen`, `ManagedConnectScreen`) against a
  mocked `TreqSsh` native module (`jest.setup.js`) and mocked
  `controlPlane`/`authStore` calls - component-level coverage of
  rendering, state, and navigation, independent of any native code or
  network calls. `mobile/src/lib/__tests__/{controlPlane,authStore}.test.ts`
  cover the control-plane client and auth store directly, against a
  mocked Supabase client (not a live Supabase stack - see prds/mobile.md's
  Phase 2 section).
- `mobile/src/screens/__tests__/*.real.test.tsx` (`npm run test:real`,
  CI job `rn-real-ssh`): the **same screens**, driven the same way
  (`@testing-library/react-native`'s `render`/`fireEvent`/`waitFor` -
  typing a connection string, pressing "Parse connection string", "Generate
  device key", "Connect", then walking Workspaces -> WorkspaceDetail ->
  Diff/Commits/Conflicts), but with `TreqSsh` backed by
  `src/native/TreqSsh.real.ts` - a thin JS shim over a real N-API build of
  `treq-mobile-ssh` (feature `napi`, `npm run build:native-test`) instead
  of a mock. This really opens a TCP connection and runs real SSH exec
  channels against a real `mock_ssh_server` process, which recognizes the
  Phase 3 CLI argv shapes and returns realistic fixture JSON
  (`mock_server::fixture_response` in `crates/treq-mobile-ssh/src/lib.rs`)
  so the screens' real JSON parsing (`treqCli.ts`) is exercised too -
  nothing about the SSH logic or response parsing is mocked. It
  substitutes a Node-hosted shim for the Swift/Kotlin marshalling layer,
  which Jest (a Node process) cannot execute - see the next two jobs for
  that layer.
- `crates/treq-mobile-ssh/ffi-tests/{kotlin,swift}` (CI jobs `kotlin-ffi`,
  `swift-ffi`): real Kotlin (JVM + JNA) and real Swift programs, calling
  the real UniFFI-generated bindings against a real `mock_ssh_server`
  process, on each language's real toolchain - publickey auth only;
  `connect_with_certificate` isn't exercised from these two yet (see
  "What's still not verified").

## What's still not verified

- `mobile/ios/TreqMobile/TreqSshBridge.swift`/`.m` and
  `mobile/android/native/kotlin/TreqSshModule.kt`/`TreqSshPackage.kt` - the
  actual `@objc`/`RCTBridgeModule` and `ReactMethod`/`NativeModule` wrapper
  code React Native would call - are not compiled or run by any job above.
  That requires a generated Xcode project (`pod install`/`xcodebuild`
  against the React-Core CocoaPod) and a generated Android Gradle project
  with the real React Native Android artifact, neither of which exists in
  this repo yet (no `npx react-native init` has been run - see "Building
  the Rust side" below). `kotlin-ffi`/`swift-ffi` prove the Rust<->Kotlin/
  Swift FFI halves those files depend on; `rn-real-ssh` proves the screens
  call the native module interface correctly; nothing yet proves the
  wrapper files themselves link and run inside a real RN app on a device
  or simulator.
- `connect_with_certificate` from Kotlin/Swift specifically: the Rust unit
  test proves the crate's certificate-auth logic works for real, but
  `ffi-tests/kotlin`/`ffi-tests/swift` were not extended to sign and
  present a certificate themselves (both languages would need their own
  certificate-building code purely to construct a test fixture, which
  didn't seem worth adding on top of the Rust-level proof).
- The control-plane client (`controlPlane.ts`, `authStore.ts`) against a
  live Supabase stack: `controlPlane.test.ts`/`authStore.test.ts` mock the
  Supabase client entirely, so the real `remote-ssh-trust` edge function's
  request/response shapes are exercised only by desktop's own tests
  today, not by anything mobile-specific.

## Building the Rust side

```sh
cd crates/treq-mobile-ssh
cargo build --target aarch64-apple-ios          # iOS device
cargo build --target aarch64-linux-android        # Android arm64
cargo run --bin uniffi-bindgen generate --library target/debug/libtreq_mobile_ssh.dylib --language swift --out-dir bindings/swift
cargo run --bin uniffi-bindgen generate --library target/debug/libtreq_mobile_ssh.so --language kotlin --out-dir bindings/kotlin
```

## Running the app

Once native projects exist:

```sh
npm install
npm run ios       # or: npm run android
```
