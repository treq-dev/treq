#!/usr/bin/env bash
# Prints the Homebrew cask for a Treq release, filling treq.rb.tmpl with the
# version and the sha256 of each macOS DMG.
#
# Usage: render-cask.sh <version> <aarch64.dmg> <x64.dmg>
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 <version> <aarch64.dmg> <x64.dmg>" >&2
  exit 2
fi

version="$1"
arm_dmg="$2"
intel_dmg="$3"
template="$(dirname "$0")/treq.rb.tmpl"

# The cask builds its download URL from the version, so only accept X.Y.Z.
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Version must be X.Y.Z without a leading v, got: $version" >&2
  exit 1
fi

sha256() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
arm_sha="$(sha256 "$arm_dmg")"
intel_sha="$(sha256 "$intel_dmg")"

sed \
  -e "s/__VERSION__/${version}/g" \
  -e "s/__SHA256_ARM__/${arm_sha}/g" \
  -e "s/__SHA256_INTEL__/${intel_sha}/g" \
  "$template"
