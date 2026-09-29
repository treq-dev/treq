#!/bin/sh
# Stand-in for the claude, codex, cursor-agent and copilot CLIs in tests.
# installFakeAgents() (test/fake-agent.ts) links this script under each CLI
# name on PATH. It prints how it was launched, then echoes every line typed
# into the terminal, so tests can assert on what the app sent to the agent.

name=$(basename "$0")
mode="default"
model="default"
prompt=""

while [ $# -gt 0 ]; do
  case "$1" in
    --permission-mode) mode="$2"; shift ;;
    --plan) mode="plan" ;;
    --model=*) model="${1#--model=}" ;;
    --) shift; while [ $# -gt 1 ]; do shift; done; prompt="$1"; break ;;
  esac
  shift
done

if [ ${#prompt} -gt 120 ]; then
  prompt="$(printf '%s' "$prompt" | cut -c1-117)..."
fi

# The prompt comes first on purpose: it repeats text from the typed command,
# which the PTY reader's echo filter must not mistake for the echo.
printf 'prompt: %s\n' "${prompt:-<none>}"
printf 'fake-agent: %s\n' "$name"
printf 'mode: %s\n' "$mode"
printf 'model: %s\n' "$model"
printf 'session: %s\n' "${TREQ_PTY_SESSION_ID:-none}"
printf 'ready\n'

while IFS= read -r line; do
  printf 'received: %s\n' "$line"
done
