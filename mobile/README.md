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

Verified so far (see "What's tested" below): the Rust SSH transport itself,
via an in-process mock SSH server, and the RN screens/native-module contract
via Jest + `@testing-library/react-native` mocking `TreqSsh`. **Not yet
verified**: the actual Swift/Kotlin bridge files compiling and running
against the real UniFFI-generated bindings, since this sandbox has no
Xcode/Gradle/NDK toolchain to run `npx react-native init`, generate the
native project shells the bridge files above need to be dropped into, build
`crates/treq-mobile-ssh` for a mobile target, or run `uniffi-bindgen
generate`. That is the next verification gap before this can run on a
device or simulator.

Still open: control-plane auth, certificate issuance, and
workspace/diff/commit screens (`prds/mobile.md` Phases 2-4 equivalents for
this app).

## What's tested

- `crates/treq-mobile-ssh/src/lib.rs` (`cargo test -p treq-mobile-ssh`):
  device key generation produces a valid ed25519 key; `connect` rejects a
  mismatched host-key fingerprint; a full connect + exec round trip against
  a real (in-process, mock) SSH server, then a rejected exec on a
  disconnected session. This is the same in-process-mock-server pattern
  `src-tauri/src/core/remote_ssh_transport.rs`'s own tests use, and proves
  the crate's SSH logic actually works, not just that it compiles.
- `mobile/src/screens/__tests__/*.test.tsx` (`npm test`): `ConnectScreen`
  and `WorkspacesScreen` against a mocked `TreqSsh` native module
  (`jest.setup.js`), using `@testing-library/react-native` (`render`,
  `fireEvent`, `waitFor`) rather than snapshot tests, covering device-key
  generation, the "no key yet" guard, a successful connect + navigation,
  and a surfaced connection error.

What is not (and cannot be, in this sandbox) tested: the native bridge
files above actually linking to a built `libtreq_mobile_ssh` and being
called by real Swift/Kotlin at runtime.

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
