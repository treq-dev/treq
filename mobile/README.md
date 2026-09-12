# Treq Mobile (React Native)

Standalone React Native app for mobile remote control, replacing the earlier
Tauri-mobile-build approach (see `prds/mobile.md`). SSH connectivity is
implemented in Rust (`crates/treq-mobile-ssh`, built on `russh`) and exposed
to this app through a native module bridge, following the pattern in
https://rust-dd.com/post/building-a-rust-native-module-for-react-native-on-ios-and-android.

## Status

Scaffold milestone: navigation, a manual connect screen, and the JS-side
native module interface (`src/native/TreqSsh.ts`) exist. Not yet done:

- Generating the `ios/` and `android/` native project shells (this repo has
  no Xcode/Gradle toolchain available to run `npx react-native init` in this
  sandbox) and dropping in the Swift/Kotlin bridge sources.
- Building `crates/treq-mobile-ssh` for iOS (XCFramework via
  `cargo build --target aarch64-apple-ios` etc.) and Android (`.so` per ABI
  via `cargo ndk`), then running `uniffi-bindgen generate` for the Swift and
  Kotlin bindings.
- Storing the generated private key from `generate_device_key` in Keychain /
  Android Keystore from the native bridge layer (never across the JS
  bridge) instead of returning it directly, as the crate does today.
- Control-plane auth, certificate issuance, and workspace/diff/commit
  screens (`prds/mobile.md` Phases 2-4 equivalents for this app).

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
