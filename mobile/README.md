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

Still open beyond that: control-plane auth, certificate issuance, and
workspace/diff/commit screens (`prds/mobile.md` Phases 2-4 equivalents for
this app). `ConnectScreen`/`WorkspacesScreen` currently take a raw
`username@host:port#fingerprint` connection string and a free-text command
(`src/lib/parseConnectionString.ts`) as a deliberately temporary stand-in
for registered endpoints and structured `treq <command> --format=json`
calls - see the comments on those two files.

## What's tested

- `crates/treq-mobile-ssh/src/lib.rs` (`cargo test -p treq-mobile-ssh`,
  CI job `rust`): device key generation produces a valid ed25519 key;
  `connect` rejects a mismatched host-key fingerprint; a full connect +
  exec round trip against a real (in-process, mock) SSH server, then a
  rejected exec on a disconnected session. Same in-process-mock-server
  pattern `src-tauri/src/core/remote_ssh_transport.rs`'s own tests use.
- `mobile/src/screens/__tests__/*.test.tsx` (`npm test`, CI job
  `rn-checks`): `ConnectScreen` and `WorkspacesScreen` against a mocked
  `TreqSsh` native module (`jest.setup.js`) - component-level coverage of
  rendering, state, and navigation, independent of any native code.
- `mobile/src/screens/__tests__/*.real.test.tsx` (`npm run test:real`,
  CI job `rn-real-ssh`): the **same screens**, driven the same way
  (`@testing-library/react-native`'s `render`/`fireEvent`/`waitFor` -
  typing a connection string, pressing "Parse connection string", "Generate
  device key", "Connect", then "Run" with a real command), but with
  `TreqSsh` backed by `src/native/TreqSsh.real.ts` - a thin JS shim over a
  real N-API build of `treq-mobile-ssh` (feature `napi`,
  `npm run build:native-test`) instead of a mock. This really opens a TCP
  connection and runs a real SSH exec channel against a real
  `mock_ssh_server` process; nothing about the SSH logic is mocked. It
  substitutes a Node-hosted shim for the Swift/Kotlin marshalling layer,
  which Jest (a Node process) cannot execute - see the next two jobs for
  that layer.
- `crates/treq-mobile-ssh/ffi-tests/{kotlin,swift}` (CI jobs `kotlin-ffi`,
  `swift-ffi`): real Kotlin (JVM + JNA) and real Swift programs, calling
  the real UniFFI-generated bindings against a real `mock_ssh_server`
  process, on each language's real toolchain.

## What's still not verified

`mobile/ios/TreqMobile/TreqSshBridge.swift`/`.m` and
`mobile/android/native/kotlin/TreqSshModule.kt`/`TreqSshPackage.kt` - the
actual `@objc`/`RCTBridgeModule` and `ReactMethod`/`NativeModule` wrapper
code React Native would call - are not compiled or run by any job above.
That requires a generated Xcode project (`pod install`/`xcodebuild` against
the React-Core CocoaPod) and a generated Android Gradle project with the
real React Native Android artifact, neither of which exists in this repo
yet (no `npx react-native init` has been run - see "Building the Rust side"
below). `kotlin-ffi`/`swift-ffi` prove the Rust<->Kotlin/Swift FFI halves
those files depend on; `rn-real-ssh` proves the screens call the native
module interface correctly; nothing yet proves the wrapper files
themselves link and run inside a real RN app on a device or simulator.

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
