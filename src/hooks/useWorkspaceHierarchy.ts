import {
  type Workspace,
  getWorkspaces,
  setWorkspaceTargetBranch,
} from "../lib/api";
import { getFullWorkspacePath } from "../lib/utils";
import { invalidateQueries } from "../lib/swr-cache";
import { useCreateStackedWorkspace } from "./useCreateStackedWorkspace";

interface UseWorkspaceHierarchyOptions {
  repoPath: string;
  workspaces: Workspace[];
  defaultBranch?: string;
}

export function useWorkspaceHierarchy({
  repoPath,
  defaultBranch = "main",
}: UseWorkspaceHierarchyOptions) {
  const { createStackedWorkspace } = useCreateStackedWorkspace();

  const invalidate = () => {
    void invalidateQueries(["workspaces", repoPath]);
    void invalidateQueries(["workspace-statuses", repoPath]);
  };

  // Add a new workspace after (as a child of) the given workspace.
  const addAfter = async (workspace: Workspace): Promise<number> => {
    const workspaceId = await createStackedWorkspace({
      repoPath,
      parentBranch: workspace.branch_name,
      parentWorkspace: workspace,
    });
    invalidate();
    return workspaceId;
  };

  // Add a new workspace before the given workspace by inserting a parent and reparenting.
  const addBefore = async (workspace: Workspace): Promise<number> => {
    const parentBranch = workspace.target_branch || defaultBranch;

    // Create new workspace stacked on the original's parent
    const newWorkspaceId = await createStackedWorkspace({
      repoPath,
      parentBranch,
      parentWorkspace: null,
    });

    // Fetch updated workspaces to get the new workspace's branch_name
    const updatedWorkspaces = await getWorkspaces(repoPath);
    const newWorkspace = updatedWorkspaces.find((w) => w.id === newWorkspaceId);

    if (newWorkspace) {
      // Reparent original workspace onto the new workspace
      const fullPath = getFullWorkspacePath(workspace);
      await setWorkspaceTargetBranch(
        repoPath,
        fullPath,
        workspace.id,
        newWorkspace.branch_name,
      );
    }

    invalidate();
    return newWorkspaceId;
  };

  // Move a workspace to a new target branch. Cycle-safe bridge lifting lives
  // in Rust core (`retarget_workspace`) so the CLI shares the same plan.
  const moveWorkspace = async (
    workspace: Workspace,
    newTargetBranch: string | null,
  ): Promise<void> => {
    const targetBranch = newTargetBranch ?? defaultBranch;
    const fullPath = getFullWorkspacePath(workspace);
    await setWorkspaceTargetBranch(
      repoPath,
      fullPath,
      workspace.id,
      targetBranch,
    );
    invalidate();
  };

  return { addAfter, addBefore, moveWorkspace };
}
