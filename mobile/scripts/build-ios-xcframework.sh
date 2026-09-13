#!/usr/bin/env bash
# Builds crates/treq-mobile-ssh for real iOS devices + the simulator, generates
# the UniFFI Swift bindings, and packages both into
# mobile/ios/TreqMobileSsh.xcframework so TreqSshBridge.swift has a real
# on-device (not just host-Swift, see the swift-ffi CI job) library to link
# against for a signed release build. Run from anywhere; paths are resolved
# relative to this script.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
crate_dir="$repo_root/crates/treq-mobile-ssh"
out_dir="$repo_root/mobile/ios"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

targets=(aarch64-apple-ios aarch64-apple-ios-sim)
for target in "${targets[@]}"; do
  rustup target add "$target" >/dev/null
  echo "==> cargo build --release --target $target"
  (cd "$crate_dir" && cargo build --release --target "$target" --lib)
done

echo "==> generating Swift bindings"
(cd "$crate_dir" && cargo run --quiet --bin uniffi-bindgen -- generate \
  --library "$repo_root/target/aarch64-apple-ios/release/libtreq_mobile_ssh.a" \
  --language swift --out-dir "$work_dir/bindings")

# uniffi-bindgen's Swift output ships a C header + modulemap that need to
# live in their own framework "headers" dir per target-triple, per Apple's
# xcframework layout.
device_headers="$work_dir/headers-device"
sim_headers="$work_dir/headers-sim"
for dir in "$device_headers" "$sim_headers"; do
  mkdir -p "$dir"
  cp "$work_dir/bindings"/*.h "$dir/"
  cp "$work_dir/bindings/treq_mobile_sshFFI.modulemap" "$dir/module.modulemap"
done
cp "$work_dir/bindings/treq_mobile_ssh.swift" "$out_dir/TreqMobile/TreqMobileSsh.swift"

rm -rf "$out_dir/TreqMobileSsh.xcframework"
xcodebuild -create-xcframework \
  -library "$repo_root/target/aarch64-apple-ios/release/libtreq_mobile_ssh.a" \
  -headers "$device_headers" \
  -library "$repo_root/target/aarch64-apple-ios-sim/release/libtreq_mobile_ssh.a" \
  -headers "$sim_headers" \
  -output "$out_dir/TreqMobileSsh.xcframework"

echo "==> wrote $out_dir/TreqMobileSsh.xcframework and $out_dir/TreqMobile/TreqMobileSsh.swift"
