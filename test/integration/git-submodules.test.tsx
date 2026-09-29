// @include-parallel
import * as React from "react";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { createTestRepo, openRepo } from "../utils";
import { render, screen, waitFor } from "../test-utils";
import { Dashboard } from "../../src/components/Dashboard";

function git(cwd: string, args: string[]) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
  });
}

function createSubmoduleRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "treq-sub-"));
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test User"]);
  fs.writeFileSync(path.join(dir, "README.md"), "sub\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "init"]);
  return dir;
}

describe("readonly git submodules", () => {
  let repoPath: string;
  let user: ReturnType<typeof userEvent.setup>;
  let pin: string;

  beforeEach(() => {
    ({ repoPath } = createTestRepo(false));
    const sub = createSubmoduleRepo();
    execFileSync(
      "git",
      [
        "-c",
        "protocol.file.allow=always",
        "submodule",
        "add",
        sub,
        "vendor/lib",
      ],
      { cwd: repoPath, encoding: "utf8" },
    );
    git(repoPath, ["commit", "-m", "add submodule"]);
    pin = git(sub, ["rev-parse", "HEAD"]).trim().slice(0, 7);
    fs.rmSync(path.join(repoPath, "vendor/lib"), {
      recursive: true,
      force: true,
    });
    openRepo(repoPath);
    user = userEvent.setup();
  });

  it("lists the nested submodule path with @pin and a default-off Sync toggle", async () => {
    render(<Dashboard />);

    const row = await screen.findByTestId("submodule-row-vendor/lib");
    await waitFor(() => {
      expect(row.textContent).toContain("vendor/lib");
      expect(row.textContent).toContain(`@ ${pin}`);
    });

    const sync = screen.getByRole("checkbox", { name: "Sync vendor/lib" });
    expect(sync).not.toBeChecked();

    await user.click(sync);
    await waitFor(() => {
      expect(
        screen.getByRole("checkbox", { name: "Sync vendor/lib" }),
      ).toBeChecked();
      expect(fs.existsSync(path.join(repoPath, "vendor/lib/.git"))).toBe(true);
    });
  });
});
