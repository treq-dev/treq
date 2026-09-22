const SEGMENT = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9_-])?$/;

export interface GitHubRepositoryName {
  owner: string;
  name: string;
}

function validateSegment(value: string, label: string): string {
  if (
    !SEGMENT.test(value) ||
    value === "." ||
    value === ".." ||
    value === ".git"
  ) {
    throw new Error(`Invalid GitHub ${label}`);
  }
  return value;
}

export function parseGitHubRepository(remote: string): GitHubRepositoryName {
  const trimmed = remote.trim();
  const match = trimmed.match(
    /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?$/i,
  );
  if (!match)
    throw new Error("The repository remote is not a canonical GitHub URL");
  return {
    owner: validateSegment(match[1], "owner"),
    name: validateSegment(match[2], "repository"),
  };
}

export function canonicalRepositoryPath(owner: string, name: string): string {
  return `/home/sprite/repos/${validateSegment(owner, "owner").toLowerCase()}/${validateSegment(name, "repository").toLowerCase()}`;
}

/**
 * The script is constant and receives validated owner/name/path as positional
 * arguments. The installation token is supplied only through GITHUB_TOKEN.
 * The temporary askpass helper contains no secret and is always removed.
 */
export function buildCloneCommand(
  owner: string,
  name: string,
): {
  argv: string[];
  script: string;
  path: string;
} {
  const safeOwner = validateSegment(owner, "owner");
  const safeName = validateSegment(name, "repository");
  const path = canonicalRepositoryPath(safeOwner, safeName);
  const script = [
    "set -eu",
    "target=$1",
    "remote=$2",
    'if [ -d "$target/.git" ] || [ -d "$target/.jj" ]; then exit 0; fi',
    'if [ -e "$target" ]; then echo "clone target already exists" >&2; exit 17; fi',
    'mkdir -p "$(dirname "$target")"',
    "askpass=$(mktemp)",
    "trap 'rm -f \"$askpass\"' EXIT HUP INT TERM",
    'printf \'%s\\n\' \'#!/bin/sh\' \'case "$1" in *Username*) printf "%s\\n" x-access-token ;; *) printf "%s\\n" "$GITHUB_TOKEN" ;; esac\' >"$askpass"',
    'chmod 700 "$askpass"',
    'GIT_ASKPASS="$askpass" GIT_TERMINAL_PROMPT=0 git clone -- "$remote" "$target"',
  ].join("\n");
  const remote = `https://github.com/${safeOwner}/${safeName}.git`;
  return { argv: ["bash", "-c", script, "bash", path, remote], script, path };
}

export function redactCloneFailure(message: string, token?: string): string {
  let safe = message.replace(
    /https:\/\/x-access-token:[^@\s]+@github\.com/gi,
    "https://github.com",
  );
  if (token) safe = safe.split(token).join("[REDACTED]");
  return safe.slice(0, 1_000);
}
