#!/bin/sh
set -eu
# shellcheck disable=SC1091
. /etc/treq/env
# npm: imports resolve from the pre-warmed DENO_DIR cache (no network, no
# node_modules); deno.json only pins nodeModulesDir to "none".
cd /home/deno/functions
exec /usr/local/bin/edge-runtime start \
  --main-service /home/deno/functions/main \
  --port "${FUNCTIONS_HTTP_PORT:-9000}" \
  --policy oneshot
