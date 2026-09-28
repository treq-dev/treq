#!/usr/bin/env bash
# PostToolUse hook (Write|Edit|MultiEdit): after any edit to technical docs,
# nudge the agent to follow the /docs-writing skill before reporting done.
set -euo pipefail

input="$(cat)"
file_path="$(printf '%s' "$input" | jq -r '.tool_response.filePath // .tool_input.file_path // empty')"

if [ -z "$file_path" ]; then
	exit 0
fi

case "$file_path" in
*web/docs/* | *web/sidebars.ts | *web/src/pages/roadmap.mdx | *web/src/pages/changelog.mdx | *web/docs/security-and-privacy.md)
	;;
*)
	exit 0
	;;
esac

marker="${TMPDIR:-/tmp}/treq-docs-writing-reminder-$(printf '%s' "$input" | jq -r '.session_id // "none"')"
# Remind once per session: repeating the same reminder after every edit
# spends context without adding information.
if [ -e "$marker" ]; then
	exit 0
fi
touch "$marker"

rel_path="$file_path"
if [ -n "${CLAUDE_PROJECT_DIR:-}" ]; then
	rel_path="${file_path#"$CLAUDE_PROJECT_DIR"/}"
fi

context="Technical documentation file changed: ${rel_path}. Before telling the user this change is done, use the /docs-writing skill: verify claims against current code (shipped vs WIP), keep prerequisites and plan gates accurate, update sibling docs that would otherwise contradict this page, and run the explain-to-me readability checker."

jq -n --arg ctx "$context" '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $ctx}}'
