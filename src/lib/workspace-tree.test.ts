import { describe, expect, it } from "vitest";
import type { Workspace, WorkspaceSidebarStatus } from "./api-types";
import {
  buildNewWorkspaceChain,
  buildWorkspaceTree,
  flattenWorkspaceTree,
  getValidTargets,
  getWorkspaceStack,
} from "./workspace-tree";

function makeWorkspace(
  id: number,
  branchName: string,
  opts: { targetBranch: string | null; createdAt?: string } = {
    targetBranch: null,
  },
): Workspace {
  return {
    id,
    repo_path: "/tmp/repo",
    workspace_name: branchName,
    workspace_path: `ws/${branchName}`,
    branch_name: branchName,
    created_at: opts.createdAt ?? "2026-01-01T00:00:00.000Z",
    target_branch: opts.targetBranch,
    title: branchName,
    not_on_remote: false,
  };
}

function makeStatus(
  id: number,
  branchName: string,
  opts: {
    targetBranch: string | null;
    createdAt?: string;
    lastActivityAt?: string | null;
  } = { targetBranch: null },
): WorkspaceSidebarStatus {
  return {
    current: makeWorkspace(id, branchName, {
      targetBranch: opts.targetBranch,
      createdAt: opts.createdAt,
    }),
    has_conflicts: false,
    last_activity_at: opts.lastActivityAt,
  };
}

function expectTree(
  statuses: WorkspaceSidebarStatus[],
  {
    expectedRootCount,
    expectedBranches,
    expectedDepths,
  }: {
    expectedRootCount: number;
    expectedBranches: string[];
    expectedDepths: number[];
  },
): void {
  const roots = buildWorkspaceTree(statuses);
  const flattened = flattenWorkspaceTree(roots);

  expect(roots).toHaveLength(expectedRootCount);
  expect(flattened.map((node) => node.branchName)).toEqual(expectedBranches);
  expect(flattened.map((node) => node.depth)).toEqual(expectedDepths);
}

describe("workspace tree root detection", () => {
  it("self-target workspace is rendered as root", () => {
    expectTree([makeStatus(1, "main", { targetBranch: "main" })], {
      expectedRootCount: 1,
      expectedBranches: ["main"],
      expectedDepths: [0],
    });
  });

  it("external target remains root", () => {
    expectTree([makeStatus(1, "feature/a", { targetBranch: "main" })], {
      expectedRootCount: 1,
      expectedBranches: ["feature/a"],
      expectedDepths: [0],
    });
  });

  it("cycle with no natural roots falls back to all roots", () => {
    expectTree(
      [
        makeStatus(1, "a", { targetBranch: "b" }),
        makeStatus(2, "b", { targetBranch: "a" }),
      ],
      {
        expectedRootCount: 2,
        expectedBranches: ["a", "b"],
        expectedDepths: [0, 0],
      },
    );
  });

  it("normal acyclic hierarchy remains unchanged", () => {
    expectTree(
      [
        makeStatus(1, "alpha", { targetBranch: null }),
        makeStatus(2, "beta", { targetBranch: "alpha" }),
        makeStatus(3, "gamma", { targetBranch: "beta" }),
      ],
      {
        expectedRootCount: 1,
        expectedBranches: ["alpha", "beta", "gamma"],
        expectedDepths: [0, 1, 2],
      },
    );
  });
});

describe("workspace tree sibling recency sort", () => {
  it("orders root siblings by last_activity_at newest first", () => {
    expectTree(
      [
        makeStatus(1, "alpha", {
          targetBranch: "main",
          lastActivityAt: "2026-01-01T00:00:00.000Z",
        }),
        makeStatus(2, "zeta", {
          targetBranch: "main",
          lastActivityAt: "2026-03-01T00:00:00.000Z",
        }),
        makeStatus(3, "beta", {
          targetBranch: "main",
          lastActivityAt: "2026-02-01T00:00:00.000Z",
        }),
      ],
      {
        expectedRootCount: 3,
        expectedBranches: ["zeta", "beta", "alpha"],
        expectedDepths: [0, 0, 0],
      },
    );
  });

  it("orders children by recency without breaking stack nesting", () => {
    expectTree(
      [
        makeStatus(1, "root", {
          targetBranch: "main",
          lastActivityAt: "2026-01-01T00:00:00.000Z",
        }),
        makeStatus(2, "child-old", {
          targetBranch: "root",
          lastActivityAt: "2026-01-02T00:00:00.000Z",
        }),
        makeStatus(3, "child-new", {
          targetBranch: "root",
          lastActivityAt: "2026-04-01T00:00:00.000Z",
        }),
        makeStatus(4, "grandchild", {
          targetBranch: "child-old",
          lastActivityAt: "2026-05-01T00:00:00.000Z",
        }),
      ],
      {
        expectedRootCount: 1,
        expectedBranches: ["root", "child-new", "child-old", "grandchild"],
        expectedDepths: [0, 1, 1, 2],
      },
    );
  });

  it("falls back to created_at when last_activity_at is missing", () => {
    expectTree(
      [
        makeStatus(1, "older", {
          targetBranch: "main",
          createdAt: "2026-01-01T00:00:00.000Z",
        }),
        makeStatus(2, "newer", {
          targetBranch: "main",
          createdAt: "2026-06-01T00:00:00.000Z",
        }),
      ],
      {
        expectedRootCount: 2,
        expectedBranches: ["newer", "older"],
        expectedDepths: [0, 0],
      },
    );
  });

  it("uses branch name as a stable tie-breaker when times match", () => {
    expectTree(
      [
        makeStatus(1, "zeta", {
          targetBranch: "main",
          lastActivityAt: "2026-02-01T00:00:00.000Z",
        }),
        makeStatus(2, "alpha", {
          targetBranch: "main",
          lastActivityAt: "2026-02-01T00:00:00.000Z",
        }),
      ],
      {
        expectedRootCount: 2,
        expectedBranches: ["alpha", "zeta"],
        expectedDepths: [0, 0],
      },
    );
  });
});

describe("workspace tree merged sort", () => {
  it("sorts merged root workspaces after unmerged ones, ignoring recency", () => {
    const statuses = [
      makeStatus(1, "old-merged", {
        targetBranch: "main",
        lastActivityAt: "2026-05-01T00:00:00.000Z",
      }),
      makeStatus(2, "new-unmerged", {
        targetBranch: "main",
        lastActivityAt: "2026-01-01T00:00:00.000Z",
      }),
      makeStatus(3, "newest-merged", {
        targetBranch: "main",
        lastActivityAt: "2026-06-01T00:00:00.000Z",
      }),
    ];
    const roots = buildWorkspaceTree(
      statuses,
      (branchName) =>
        branchName === "old-merged" || branchName === "newest-merged",
    );
    const flattened = flattenWorkspaceTree(roots);
    expect(flattened.map((node) => node.branchName)).toEqual([
      "new-unmerged",
      "newest-merged",
      "old-merged",
    ]);
  });

  it("sorts merged children after unmerged siblings within a stack", () => {
    const statuses = [
      makeStatus(1, "root", { targetBranch: "main" }),
      makeStatus(2, "merged-child", { targetBranch: "root" }),
      makeStatus(3, "unmerged-child", { targetBranch: "root" }),
    ];
    const roots = buildWorkspaceTree(
      statuses,
      (branchName) => branchName === "merged-child",
    );
    const flattened = flattenWorkspaceTree(roots);
    expect(flattened.map((node) => node.branchName)).toEqual([
      "root",
      "unmerged-child",
      "merged-child",
    ]);
  });
});

describe("getWorkspaceStack", () => {
  it("returns null when a lone workspace targets an external branch", () => {
    const workspaces = [
      makeWorkspace(1, "feature/a", { targetBranch: "main" }),
    ];
    expect(getWorkspaceStack(workspaces, 1)).toBeNull();
  });

  it("returns null when the workspace has no target_branch at all", () => {
    const workspaces = [makeWorkspace(1, "feature/a", { targetBranch: null })];
    expect(getWorkspaceStack(workspaces, 1)).toBeNull();
  });

  it("returns null when the workspace id is not found", () => {
    const workspaces = [
      makeWorkspace(1, "feature/a", { targetBranch: "main" }),
    ];
    expect(getWorkspaceStack(workspaces, 999)).toBeNull();
  });

  it("returns the ordered stack (tip-first, root-last) for a stacked workspace", () => {
    const workspaces = [
      makeWorkspace(1, "chore/refactor", { targetBranch: "main" }),
      makeWorkspace(2, "feat/context-prompts", {
        targetBranch: "chore/refactor",
      }),
      makeWorkspace(3, "feat/ai-summaries", {
        targetBranch: "feat/context-prompts",
      }),
      makeWorkspace(4, "docs/ai-guidelines", {
        targetBranch: "feat/ai-summaries",
      }),
    ];

    const stack = getWorkspaceStack(workspaces, 3);

    expect(stack).not.toBeNull();
    expect(stack!.map((entry) => entry.workspace.branch_name)).toEqual([
      "docs/ai-guidelines",
      "feat/ai-summaries",
      "feat/context-prompts",
      "chore/refactor",
    ]);
  });

  it("returns the full stack when viewing the first (root) workspace of a stack", () => {
    const workspaces = [
      makeWorkspace(1, "chore/refactor", { targetBranch: "main" }),
      makeWorkspace(2, "feat/context-prompts", {
        targetBranch: "chore/refactor",
      }),
      makeWorkspace(3, "feat/ai-summaries", {
        targetBranch: "feat/context-prompts",
      }),
    ];

    const stack = getWorkspaceStack(workspaces, 1);

    expect(stack).not.toBeNull();
    expect(stack!.map((entry) => entry.workspace.branch_name)).toEqual([
      "feat/ai-summaries",
      "feat/context-prompts",
      "chore/refactor",
    ]);
    expect(stack!.map((entry) => entry.isCurrent)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("marks only the requested workspace as current", () => {
    const workspaces = [
      makeWorkspace(1, "chore/refactor", { targetBranch: "main" }),
      makeWorkspace(2, "feat/context-prompts", {
        targetBranch: "chore/refactor",
      }),
      makeWorkspace(3, "feat/ai-summaries", {
        targetBranch: "feat/context-prompts",
      }),
    ];

    const stack = getWorkspaceStack(workspaces, 2);

    expect(stack!.map((entry) => entry.isCurrent)).toEqual([
      false, // feat/ai-summaries
      true, // feat/context-prompts (requested)
      false, // chore/refactor
    ]);
  });

  it("omits siblings of the current workspace but keeps sibling descendants", () => {
    const workspaces = [
      makeWorkspace(1, "main", { targetBranch: "stable" }),
      makeWorkspace(2, "feat/sibling-a", { targetBranch: "main" }),
      makeWorkspace(3, "fix/current", { targetBranch: "main" }),
      makeWorkspace(4, "feat/sibling-b", { targetBranch: "main" }),
      makeWorkspace(5, "feat/child-a", { targetBranch: "fix/current" }),
      makeWorkspace(6, "feat/child-b", { targetBranch: "fix/current" }),
      makeWorkspace(7, "feat/grandchild", { targetBranch: "feat/child-a" }),
    ];

    const stack = getWorkspaceStack(workspaces, 3);

    expect(stack!.map((entry) => entry.workspace.branch_name)).toEqual([
      "feat/grandchild",
      "feat/child-b",
      "feat/child-a",
      "fix/current",
      "main",
    ]);
  });

  it("returns a stack entry for a workspace positioned at the tip", () => {
    const workspaces = [
      makeWorkspace(1, "chore/refactor", { targetBranch: "main" }),
      makeWorkspace(2, "feat/context-prompts", {
        targetBranch: "chore/refactor",
      }),
    ];

    const stack = getWorkspaceStack(workspaces, 2);

    expect(stack).not.toBeNull();
    expect(stack).toHaveLength(2);
    expect(stack![0]).toEqual({
      workspace: workspaces[1],
      isCurrent: true,
    });
  });
});

describe("getValidTargets", () => {
  it("allows descendants so parent/child stack reorders can be planned", () => {
    const a = makeWorkspace(1, "feat/a", { targetBranch: "main" });
    const b = makeWorkspace(2, "feat/b", { targetBranch: "feat/a" });
    const c = makeWorkspace(3, "feat/c", { targetBranch: "feat/b" });
    const other = makeWorkspace(4, "feat/other", { targetBranch: "main" });

    expect(getValidTargets([a, b, c, other], "feat/a").sort()).toEqual([
      "feat/b",
      "feat/c",
      "feat/other",
    ]);
  });

  it("never includes the workspace itself", () => {
    const a = makeWorkspace(1, "feat/a", { targetBranch: "main" });
    const b = makeWorkspace(2, "feat/b", { targetBranch: "feat/a" });

    expect(getValidTargets([a, b], "feat/a")).not.toContain("feat/a");
  });
});

describe("buildNewWorkspaceChain", () => {
  const stack = [
    makeWorkspace(1, "feat/a", { targetBranch: "main" }),
    makeWorkspace(2, "feat/b", { targetBranch: "feat/a" }),
  ];
  const labels = (entries: ReturnType<typeof buildNewWorkspaceChain>) =>
    entries.map((entry) => (entry.kind === "new" ? "[new]" : entry.branch));

  it("returns only the new entry when stacking on the default branch", () => {
    expect(
      labels(
        buildNewWorkspaceChain(stack, {
          parentBranch: "main",
          position: "after",
          defaultBranch: "main",
        }),
      ),
    ).toEqual(["[new]"]);
  });

  it("puts the new entry above the parent chain when position is after", () => {
    expect(
      labels(
        buildNewWorkspaceChain(stack, {
          parentBranch: "feat/b",
          position: "after",
          defaultBranch: "main",
        }),
      ),
    ).toEqual(["[new]", "feat/b", "feat/a"]);
  });

  it("puts the new entry below the parent when position is before", () => {
    expect(
      labels(
        buildNewWorkspaceChain(stack, {
          parentBranch: "feat/b",
          position: "before",
          defaultBranch: "main",
        }),
      ),
    ).toEqual(["feat/b", "[new]", "feat/a"]);
  });

  it("includes a parent branch that is not yet a workspace", () => {
    const entries = buildNewWorkspaceChain(stack, {
      parentBranch: "local-branch",
      position: "after",
      defaultBranch: "main",
    });
    expect(labels(entries)).toEqual(["[new]", "local-branch"]);
    expect(entries[1]).toMatchObject({ kind: "branch", workspace: null });
  });

  it("stops walking when target branches form a cycle", () => {
    const cyclic = [
      makeWorkspace(1, "x", { targetBranch: "y" }),
      makeWorkspace(2, "y", { targetBranch: "x" }),
    ];
    expect(
      labels(
        buildNewWorkspaceChain(cyclic, {
          parentBranch: "x",
          position: "after",
          defaultBranch: "main",
        }),
      ),
    ).toEqual(["[new]", "x", "y"]);
  });
});
