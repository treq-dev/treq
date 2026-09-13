#!/usr/bin/env bash
# Builds crates/treq-mobile-ssh with the `napi` feature and copies the
# resulting cdylib to mobile/native-test/treq_mobile_ssh.node, so Jest's
# "real" test project (jest.config.real.js) can require the actual
# compiled Rust SSH implementation instead of a hand-written mock - see
# mobile/README.md "What's tested" and src/native/TreqSsh.real.ts.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
out_dir="$repo_root/mobile/native-test"
mkdir -p "$out_dir"

cargo build --manifest-path "$repo_root/crates/treq-mobile-ssh/Cargo.toml" \
  --lib --features napi

target_dir="$repo_root/target/debug"
if [ -f "$target_dir/libtreq_mobile_ssh.so" ]; then
  cp "$target_dir/libtreq_mobile_ssh.so" "$out_dir/treq_mobile_ssh.node"
elif [ -f "$target_dir/libtreq_mobile_ssh.dylib" ]; then
  cp "$target_dir/libtreq_mobile_ssh.dylib" "$out_dir/treq_mobile_ssh.node"
elif [ -f "$target_dir/treq_mobile_ssh.dll" ]; then
  cp "$target_dir/treq_mobile_ssh.dll" "$out_dir/treq_mobile_ssh.node"
else
  echo "error: no treq_mobile_ssh cdylib found in $target_dir" >&2
  exit 1
fi

echo "wrote $out_dir/treq_mobile_ssh.node"

cargo build --manifest-path "$repo_root/crates/treq-mobile-ssh/Cargo.toml" \
  --example mock_ssh_server --features ffi-tests
cp "$target_dir/examples/mock_ssh_server" "$out_dir/mock_ssh_server"
echo "wrote $out_dir/mock_ssh_server"
