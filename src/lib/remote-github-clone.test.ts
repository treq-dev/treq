import { describe, expect, it } from "vitest";
import {
  buildCloneCommand,
  canonicalRepositoryPath,
  parseGitHubRepository,
  redactCloneFailure,
} from "../../supabase/functions/_shared/remote/github-clone";

describe("managed GitHub clone", () => {
  it("normalizes HTTPS and SSH GitHub remotes", () => {
    expect(parseGitHubRepository("https://github.com/Acme/treq.git")).toEqual({
      owner: "Acme",
      name: "treq",
    });
    expect(parseGitHubRepository("git@github.com:Acme/treq.git")).toEqual({
      owner: "Acme",
      name: "treq",
    });
  });

  it("creates a deterministic path and rejects traversal", () => {
    expect(canonicalRepositoryPath("Acme", "Treq")).toBe(
      "/home/sprite/repos/acme/treq",
    );
    expect(() => canonicalRepositoryPath("acme", "../treq")).toThrow();
  });

  it("keeps credentials out of clone argv and stored configuration", () => {
    const command = buildCloneCommand("acme", "treq");
    expect(command.argv.join(" ")).not.toContain("github_pat_secret");
    expect(command.script).toContain("$GITHUB_TOKEN");
    expect(command.script).not.toContain("credential.helper store");
    expect(command.script).not.toContain("git config --global");
  });

  it("redacts tokens and credential-bearing URLs from errors", () => {
    const secret = "github_pat_secret";
    const safe = redactCloneFailure(
      `fatal https://x-access-token:${secret}@github.com/acme/treq ${secret}`,
      secret,
    );
    expect(safe).not.toContain(secret);
    expect(safe).not.toContain("x-access-token:");
  });
});
