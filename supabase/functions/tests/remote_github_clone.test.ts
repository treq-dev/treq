import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCloneCommand,
  canonicalRepositoryPath,
  parseGitHubRepository,
  redactCloneFailure,
} from "../_shared/remote/github-clone.ts";

Deno.test("canonical path is deterministic and rejects unsafe repository names", () => {
  assertEquals(
    canonicalRepositoryPath("Acme", "treq"),
    "/home/sprite/repos/acme/treq",
  );
  for (const unsafe of ["../treq", "a/b", ".git", "white space"]) {
    let rejected = false;
    try {
      canonicalRepositoryPath("acme", unsafe);
    } catch {
      rejected = true;
    }
    assert(rejected);
  }
});

Deno.test("canonical GitHub remotes accept HTTPS and SSH", () => {
  assertEquals(parseGitHubRepository("https://github.com/Acme/treq.git"), {
    owner: "Acme",
    name: "treq",
  });
  assertEquals(parseGitHubRepository("git@github.com:Acme/treq.git"), {
    owner: "Acme",
    name: "treq",
  });
});

Deno.test("clone command gets credentials only from the environment", () => {
  const token = "github_pat_secret_value";
  const command = buildCloneCommand("Acme", "treq");
  assertFalse(JSON.stringify(command).includes(token));
  assert(command.script.includes("$GITHUB_TOKEN"));
  assertFalse(command.script.includes("git config --global"));
  assertFalse(command.script.includes("credential.helper store"));
});

Deno.test("clone failures redact tokens and credential URLs", () => {
  const secret = "github_pat_secret_value";
  const redacted = redactCloneFailure(
    `fatal: https://x-access-token:${secret}@github.com/acme/treq ${secret}`,
    secret,
  );
  assertFalse(redacted.includes(secret));
  assertFalse(redacted.includes("x-access-token:"));
});
