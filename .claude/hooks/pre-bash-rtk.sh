#!/usr/bin/env bash
# PreToolUse hook (Bash): rewrite commands through rtk (https://github.com/rtk-ai/rtk)
# so test, build, and git output reaches the context in compact form.
# No-op when rtk is not installed.
set -euo pipefail

command -v rtk >/dev/null 2>&1 || exit 0

input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty')"

# rtk rewrites `npm run lint` and `biome ...` to `rtk lint`, which runs ESLint:
# the first would skip the oxlint and ast-grep steps of our lint script, the
# second would swap Biome for ESLint. Leave both unwrapped.
if printf '%s' "$cmd" | grep -Eq 'npm run lint($|[^:[:alnum:]_-])|(^|[;&| ])(npx )?biome( |$)'; then
	exit 0
fi

printf '%s' "$input" | RTK_SUPPRESS_HOOK_WARNING=1 rtk hook claude
