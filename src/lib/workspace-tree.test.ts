import { describe, expect, it } from "vitest";
import type { Workspace, WorkspaceSidebarStatus } from "./api-types";
import {
	buildWorkspaceTree,
	flattenWorkspaceTree,
	getValidTargets,
	getWorkspaceStack,
} from "./workspace-tree";

function makeWorkspace(
	id: number,
	branchName: string,
	targetBranch: string | null,
): Workspace {
	return {
		id,
		repo_path: "/tmp/repo",
		workspace_name: branchName,
		workspace_path: `ws/${branchName}`,
		branch_name: branchName,
		created_at: "2026-01-01T00:00:00.000Z",
		target_branch: targetBranch,
		title: branchName,
		not_on_remote: false,
		archived: false,
	};
}

function makeStatus(
	id: number,
	branchName: string,
	targetBranch: string | null,
): WorkspaceSidebarStatus {
	return {
		current: makeWorkspace(id, branchName, targetBranch),
		has_conflicts: false,
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
		expectTree([makeStatus(1, "main", "main")], {
			expectedRootCount: 1,
			expectedBranches: ["main"],
			expectedDepths: [0],
		});
	});

	it("external target remains root", () => {
		expectTree([makeStatus(1, "feature/a", "main")], {
			expectedRootCount: 1,
			expectedBranches: ["feature/a"],
			expectedDepths: [0],
		});
	});

	it("cycle with no natural roots falls back to all roots", () => {
		expectTree([makeStatus(1, "a", "b"), makeStatus(2, "b", "a")], {
			expectedRootCount: 2,
			expectedBranches: ["a", "b"],
			expectedDepths: [0, 0],
		});
	});

	it("normal acyclic hierarchy remains unchanged", () => {
		expectTree(
			[
				makeStatus(1, "alpha", null),
				makeStatus(2, "beta", "alpha"),
				makeStatus(3, "gamma", "beta"),
			],
			{
				expectedRootCount: 1,
				expectedBranches: ["alpha", "beta", "gamma"],
				expectedDepths: [0, 1, 2],
			},
		);
	});
});

describe("getWorkspaceStack", () => {
	it("returns null when a lone workspace targets an external branch", () => {
		const workspaces = [makeWorkspace(1, "feature/a", "main")];
		expect(getWorkspaceStack(workspaces, 1)).toBeNull();
	});

	it("returns null when the workspace has no target_branch at all", () => {
		const workspaces = [makeWorkspace(1, "feature/a", null)];
		expect(getWorkspaceStack(workspaces, 1)).toBeNull();
	});

	it("returns null when the workspace id is not found", () => {
		const workspaces = [makeWorkspace(1, "feature/a", "main")];
		expect(getWorkspaceStack(workspaces, 999)).toBeNull();
	});

	it("returns the ordered stack (tip-first, root-last) for a stacked workspace", () => {
		const workspaces = [
			makeWorkspace(1, "chore/refactor", "main"),
			makeWorkspace(2, "feat/context-prompts", "chore/refactor"),
			makeWorkspace(3, "feat/ai-summaries", "feat/context-prompts"),
			makeWorkspace(4, "docs/ai-guidelines", "feat/ai-summaries"),
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
			makeWorkspace(1, "chore/refactor", "main"),
			makeWorkspace(2, "feat/context-prompts", "chore/refactor"),
			makeWorkspace(3, "feat/ai-summaries", "feat/context-prompts"),
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
			makeWorkspace(1, "chore/refactor", "main"),
			makeWorkspace(2, "feat/context-prompts", "chore/refactor"),
			makeWorkspace(3, "feat/ai-summaries", "feat/context-prompts"),
		];

		const stack = getWorkspaceStack(workspaces, 2);

		expect(stack!.map((entry) => entry.isCurrent)).toEqual([
			false, // feat/ai-summaries
			true, // feat/context-prompts (requested)
			false, // chore/refactor
		]);
	});

	it("returns a stack entry for a workspace positioned at the tip", () => {
		const workspaces = [
			makeWorkspace(1, "chore/refactor", "main"),
			makeWorkspace(2, "feat/context-prompts", "chore/refactor"),
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
		const a = makeWorkspace(1, "feat/a", "main");
		const b = makeWorkspace(2, "feat/b", "feat/a");
		const c = makeWorkspace(3, "feat/c", "feat/b");
		const other = makeWorkspace(4, "feat/other", "main");

		expect(getValidTargets([a, b, c, other], "feat/a").sort()).toEqual([
			"feat/b",
			"feat/c",
			"feat/other",
		]);
	});

	it("never includes the workspace itself", () => {
		const a = makeWorkspace(1, "feat/a", "main");
		const b = makeWorkspace(2, "feat/b", "feat/a");

		expect(getValidTargets([a, b], "feat/a")).not.toContain("feat/a");
	});
});
