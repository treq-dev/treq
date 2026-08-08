import type { Workspace, WorkspaceStatus } from "../../src/lib/api";

type WorkspaceFactoryOptions = Partial<Workspace>;

let nextId = 1;

/**
 * Factory function to create mock Workspace objects.
 * Generates a unique id/branch unless overridden.
 *
 * @example
 * const workspace = createMockWorkspace();
 *
 * // Override specific values
 * const stacked = createMockWorkspace({
 *   branch_name: "feat/beta",
 *   target_branch: "feat/alpha",
 * });
 */
export function createMockWorkspace(
	overrides: WorkspaceFactoryOptions = {},
): Workspace {
	const id = overrides.id ?? nextId++;
	const branchName = overrides.branch_name ?? `workspace-${id}`;

	return {
		id,
		repo_path: "/Users/test/repo",
		workspace_name: branchName,
		workspace_path: `/Users/test/repo/.treq/workspaces/${branchName}`,
		branch_name: branchName,
		title: branchName,
		created_at: new Date().toISOString(),
		not_on_remote: false,
		archived: false,
		...overrides,
	};
}

type WorkspaceStatusFactoryOptions = Partial<WorkspaceStatus>;

/**
 * Factory function to create mock WorkspaceStatus objects, as returned by
 * getWorkspaceStatus().
 */
export function createMockWorkspaceStatus(
	overrides: WorkspaceStatusFactoryOptions = {},
): WorkspaceStatus {
	return {
		current: createMockWorkspace(),
		has_conflicts: false,
		has_changes: false,
		conflicted_files: [],
		remote_sync: { type: "InSync" },
		target: null,
		children: [],
		dag_nodes: [],
		conflicted_workspace_ids: [],
		commits_ahead_of_target: [],
		...overrides,
	};
}
