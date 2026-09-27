import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCommit,
  createWorkspace,
  getCommitDiff,
  getCommitFileDiff,
  getWorkspaceDiff,
  getWorkspaceFileHunks,
  jjGetCommitsAhead,
  jjRestoreFile,
  jjSplit,
  loadFileBrowserReview,
  mergeWorkspace,
  moveWorkspaceChanges,
  readFile,
  saveFileBrowserReview,
  searchWorkspaceFiles,
  setWorkspaceTargetBranch,
} from "./api";
import {
  localActiveRepository,
  setActiveRepositorySingleton,
  type ActiveRepository,
} from "./active-repository";
import type { SshEndpoint } from "./api-types-remote";
import {
  dispatch,
  dispatchMutationOverSsh,
  type TreqCommandRequest,
} from "./remote-dispatch";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

vi.mock("./remote-dispatch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./remote-dispatch")>();
  return {
    ...actual,
    dispatch: vi.fn(),
    dispatchMutationOverSsh: vi.fn(),
  };
});

vi.mock("./swr-cache", () => ({
  invalidateQueries: vi.fn(() => Promise.resolve()),
}));

const ROOT = "/srv/project";
const WORKSPACE_DIR = `${ROOT}/.treq/workspaces/feat-a`;
const endpoint = { id: "endpoint-1" } as unknown as SshEndpoint;

function remoteRepo(): ActiveRepository {
  return {
    id: "remote-1",
    location: { type: "ssh", host: "box", path: ROOT },
    endpoint,
    endpointId: "endpoint-1",
    endpointGeneration: 1,
    canonicalPath: ROOT,
    displayName: "project",
    transport: { type: "ssh", endpoint },
  };
}

function sentReads(): TreqCommandRequest[] {
  return vi.mocked(dispatch).mock.calls.map(([, request]) => request);
}

function sentMutations(): TreqCommandRequest[] {
  return vi
    .mocked(dispatchMutationOverSsh)
    .mock.calls.map(([, request]) => request);
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(dispatch).mockReset();
  vi.mocked(dispatchMutationOverSsh).mockReset();
  vi.mocked(dispatchMutationOverSsh).mockResolvedValue({
    status: "applied",
    value: "ok",
  });
  vi.mocked(dispatch).mockImplementation(async (_endpoint, request) => {
    if (request.kind === "ListWorkspaces") {
      return [{ id: 7, workspace_path: "feat-a", branch_name: "feat-a" }];
    }
    return [];
  });
  setActiveRepositorySingleton(remoteRepo());
});

afterEach(() => {
  setActiveRepositorySingleton(null);
});

describe("remote repository reads", () => {
  it("loads the full workspace diff, including committed files, in one typed read", async () => {
    const diff = {
      uncommitted_files: [],
      committed_files: [{ path: "a.rs", status: "M" }],
      conflicted_files: [],
      hunks_by_file: [],
      too_large_to_render: false,
    };
    vi.mocked(dispatch).mockResolvedValueOnce(diff);

    await expect(getWorkspaceDiff(ROOT, 7)).resolves.toEqual(diff);
    expect(sentReads()).toEqual([
      { kind: "WorkspaceDiff", repo: ROOT, workspace: "7" },
    ]);
  });

  it("routes commit diffs, file hunks, and file search through typed reads", async () => {
    await getCommitDiff(ROOT, 7, "abc");
    await getCommitFileDiff(ROOT, null, "abc", "a.rs");
    await getWorkspaceFileHunks(ROOT, 7, "a.rs");
    await searchWorkspaceFiles(ROOT, 7, "main", 4);

    expect(sentReads()).toEqual([
      { kind: "CommitDiff", repo: ROOT, workspace: "7", revision: "abc" },
      {
        kind: "CommitFileDiff",
        repo: ROOT,
        workspace: null,
        revision: "abc",
        path: "a.rs",
      },
      { kind: "DiffFile", repo: ROOT, workspace: "7", path: "a.rs" },
      {
        kind: "SearchFiles",
        repo: ROOT,
        workspace: "7",
        query: "main",
        limit: 4,
      },
    ]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("reads a workspace file through the typed ReadFile command", async () => {
    vi.mocked(dispatch).mockImplementation(async (_endpoint, request) => {
      if (request.kind === "ListWorkspaces") {
        return [{ id: 7, workspace_path: "feat-a" }];
      }
      return { lines: ["one", "two"], start_line: 1, end_line: 2 };
    });

    await expect(readFile(`${WORKSPACE_DIR}/src/a.rs`)).resolves.toBe(
      "one\ntwo\n",
    );
    expect(sentReads()[1]).toMatchObject({
      kind: "ReadFile",
      repo: ROOT,
      workspace: "7",
      path: "src/a.rs",
      revision: "WorkingCopy",
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("keeps a remote file-browser review draft off the local database", async () => {
    await saveFileBrowserReview(ROOT, 7, [], "summary");
    const saved = await loadFileBrowserReview(ROOT, 7);
    expect(saved?.summary_text).toBe("summary");
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("remote repository mutations", () => {
  it("sends CreateCommit over SSH with a fresh idempotency key per call", async () => {
    await createCommit(ROOT, 7, "wip");
    await createCommit(ROOT, 7, "wip");

    const [first, second] = sentMutations();
    expect(first).toMatchObject({
      kind: "CreateCommit",
      repo: ROOT,
      workspace: "7",
      message: "wip",
    });
    const firstKey = (first as { idempotency_key: string }).idempotency_key;
    const secondKey = (second as { idempotency_key: string }).idempotency_key;
    expect(firstKey).toBeTruthy();
    expect(secondKey).toBeTruthy();
    expect(firstKey).not.toBe(secondKey);
    expect(vi.mocked(dispatchMutationOverSsh).mock.calls[0][0]).toBe(endpoint);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("surfaces an ambiguous mutation as an error instead of success", async () => {
    vi.mocked(dispatchMutationOverSsh).mockResolvedValueOnce({
      status: "ambiguous",
      reason: "state unknown",
    });
    await expect(createCommit(ROOT, 7, "wip")).rejects.toThrow("state unknown");
  });

  it("returns the new workspace id from a remote create", async () => {
    vi.mocked(dispatchMutationOverSsh).mockResolvedValueOnce({
      status: "applied",
      value: { id: 12, branch_name: "feat-b" },
    });
    await expect(
      createWorkspace(ROOT, "feat-b", "main", '{"title":"T"}'),
    ).resolves.toBe(12);
    expect(sentMutations()[0]).toMatchObject({
      kind: "CreateWorkspace",
      branch_name: "feat-b",
      source_branch: "main",
      metadata: '{"title":"T"}',
    });
  });

  it("keeps files and hunks when moving workspace changes", async () => {
    vi.mocked(dispatchMutationOverSsh).mockResolvedValueOnce({
      status: "applied",
      value: { files_moved: 1 },
    });
    const hunk = { file_path: "b.rs", start_line: 2, end_line: 4 };
    await moveWorkspaceChanges(ROOT, "feat-a", "feat-b", {
      files: ["a.rs"],
      hunks: [hunk],
      commits: [],
    });
    expect(sentMutations()[0]).toMatchObject({
      kind: "MoveWorkspaceChanges",
      workspace: "feat-a",
      destination: "feat-b",
      files: ["a.rs"],
      hunks: [hunk],
      commits: [],
    });
  });

  it("splits the working copy of the workspace a path belongs to", async () => {
    await jjSplit(WORKSPACE_DIR, "first half", ["a.rs"]);
    expect(sentMutations()[0]).toMatchObject({
      kind: "SplitCommit",
      repo: ROOT,
      workspace: "7",
      commit: "@",
      files: ["a.rs"],
      hunks: [],
      message: "first half",
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("restores a file and retargets a workspace through typed commands", async () => {
    await jjRestoreFile(WORKSPACE_DIR, "a.rs");
    await setWorkspaceTargetBranch(ROOT, WORKSPACE_DIR, 7, "feat-b");
    expect(sentMutations()).toMatchObject([
      { kind: "RestoreFile", repo: ROOT, workspace: "7", path: "a.rs" },
      {
        kind: "RebaseWorkspace",
        repo: ROOT,
        workspace: "7",
        target_branch: "feat-b",
      },
    ]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("refuses operations with no typed command instead of running them locally", async () => {
    await expect(mergeWorkspace(ROOT, 7, "msg", "squash")).rejects.toThrow(
      /^unsupported:/,
    );
    await expect(jjGetCommitsAhead(WORKSPACE_DIR, "main")).rejects.toThrow(
      /^unsupported:/,
    );
    expect(invoke).not.toHaveBeenCalled();
    expect(dispatchMutationOverSsh).not.toHaveBeenCalled();
  });
});

describe("local repositories", () => {
  it("still use the local Tauri commands", async () => {
    setActiveRepositorySingleton(localActiveRepository("/home/me/project"));
    vi.mocked(invoke).mockResolvedValue("done");

    await createCommit("/home/me/project", 3, "msg");
    await jjSplit("/home/me/project/.treq/workspaces/x", "m", ["a"]);

    expect(invoke).toHaveBeenCalledWith("create_commit", {
      repoPath: "/home/me/project",
      workspaceId: 3,
      message: "msg",
    });
    expect(invoke).toHaveBeenCalledWith("jj_split", {
      workspacePath: "/home/me/project/.treq/workspaces/x",
      message: "m",
      filePaths: ["a"],
    });
    expect(dispatchMutationOverSsh).not.toHaveBeenCalled();
  });
});
