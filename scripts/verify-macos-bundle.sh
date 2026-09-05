#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 /path/to/Treq.app" >&2
  exit 2
fi

APP_BUNDLE="$1"
EXECUTABLE="$APP_BUNDLE/Contents/MacOS/treq"

if [[ ! -f "$EXECUTABLE" ]]; then
  echo "Missing app executable: $EXECUTABLE" >&2
  exit 1
fi

codesign --verify --deep --strict "$APP_BUNDLE"
echo "Verified macOS bundle: $APP_BUNDLE"
