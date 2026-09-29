// @include-parallel
import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createTestRepo,
  gitCommitRepoFile,
  resolveWorkspacePath,
} from "../../utils";
import * as api from "../../../src/lib/api";

describe("Sparse checkout workspace creation", () => {
  let repoPath: string;

  beforeEach(async () => {
    ({ repoPath } = createTestRepo(false));
    await gitCommitRepoFile(
      repoPath,
      "src/lib.ts",
      "export {};",
      "add src/lib.ts",
    );
    await gitCommitRepoFile(repoPath, "docs/guide.md", "# Guide", "add docs");
  });

  it("materializes only matching paths and persists patterns", async () => {
    await api.createWorkspace(
      repoPath,
      "feat/sparse-int",
      undefined,
      JSON.stringify({ sparse_patterns: ["src"] }),
    );

    const workspace = (await api.getWorkspaces(repoPath)).find(
      (candidate) => candidate.branch_name === "feat/sparse-int",
    );
    expect(workspace).toBeTruthy();
    expect(workspace!.sparse_patterns).toEqual(["src"]);

    const workspacePath = resolveWorkspacePath(
      repoPath,
      workspace!.workspace_path,
    );
    expect(fs.existsSync(path.join(workspacePath, "src/lib.ts"))).toBe(true);
    expect(fs.existsSync(path.join(workspacePath, "docs"))).toBe(false);
  });

  it("creates a full workspace when no sparse patterns are given", async () => {
    await api.createWorkspace(repoPath, "feat/full-int");

    const workspace = (await api.getWorkspaces(repoPath)).find(
      (candidate) => candidate.branch_name === "feat/full-int",
    );
    expect(workspace).toBeTruthy();
    expect(workspace!.sparse_patterns ?? null).toBeNull();

    const workspacePath = resolveWorkspacePath(
      repoPath,
      workspace!.workspace_path,
    );
    expect(fs.existsSync(path.join(workspacePath, "src/lib.ts"))).toBe(true);
    expect(fs.existsSync(path.join(workspacePath, "docs/guide.md"))).toBe(true);
  });
});
