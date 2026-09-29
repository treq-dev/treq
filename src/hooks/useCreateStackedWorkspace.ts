import {
  type Workspace,
  createWorkspace,
  getRepoDefaultBranch,
  getRepoSetting,
  getWorkspaces,
  setWorkspaceTargetBranch,
} from "../lib/api";
import { generateStackedBranchName, getFullWorkspacePath } from "../lib/utils";
import { useToast } from "../components/ui/toast";
import { useRepositoryCacheKey } from "../lib/active-repository-context";
import { invalidateQueries } from "../lib/swr-cache";

export interface CreateStackedWorkspaceOptions {
  repoPath: string;
  parentBranch: string;
  parentWorkspace: Workspace | null;
  // If provided, use this branch name instead of auto-generating.
  branchName?: string;
  // If provided, use this description instead of auto-generating.
  description?: string;
  // Position relative to parent; "before" triggers reparenting. Default: "after".
  position?: "before" | "after";
  // Called as soon as the workspace exists, before the follow-up retargets.
  onCreated?: (workspaceId: number) => void;
  // When false, failures are only thrown; the caller reports them.
  reportErrors?: boolean;
}

export function useCreateStackedWorkspace() {
  const { addToast } = useToast();
  // Dashboard keys its workspace lists by repository identity, which differs
  // from the path for remote repositories.
  const activeRepoKey = useRepositoryCacheKey();

  const createStackedWorkspace = async ({
    repoPath,
    parentBranch,
    parentWorkspace,
    branchName: userBranchName,
    description: userIntent,
    position = "after",
    onCreated,
    reportErrors = true,
  }: CreateStackedWorkspaceOptions) => {
    try {
      // Step 1: Load branch pattern (only needed if auto-generating)
      const branchPattern = userBranchName
        ? "treq/{name}" // unused but need a fallback
        : (await getRepoSetting(repoPath, "branch_name_pattern").catch(
            () => null,
          )) || "treq/{name}";

      // Step 2: Get existing workspaces to ensure unique branch name
      const existingWorkspaces = await getWorkspaces(repoPath);
      // The parent may have been removed while the dialog was open; don't
      // create an orphan that targets a branch that no longer exists.
      const currentParent = parentWorkspace
        ? existingWorkspaces.find((w) => w.id === parentWorkspace.id)
        : null;
      if (parentWorkspace && !currentParent) {
        throw new Error(
          `Workspace ${parentWorkspace.branch_name} no longer exists`,
        );
      }
      const existingBranches = new Set(
        existingWorkspaces.map((w) => w.branch_name),
      );

      // Step 3: Determine branch name
      let branchName: string;
      if (userBranchName) {
        branchName = userBranchName;
      } else {
        let index = 1;
        do {
          branchName = generateStackedBranchName(
            branchPattern,
            parentBranch,
            index,
          );
          index++;
        } while (existingBranches.has(branchName));
      }

      // Step 4: Persist only a user-written description; an auto one goes stale on reorder.
      const metadata =
        userIntent !== undefined
          ? JSON.stringify({ description: userIntent })
          : undefined;

      // "before": new workspace targets parent's parent (default branch if unset); original parent reparents onto it.
      const defaultBranch = await getRepoDefaultBranch(repoPath);
      const effectiveParentBranch =
        position === "before" && currentParent
          ? currentParent.target_branch || defaultBranch
          : parentBranch;

      // Step 5: Create workspace. No source for the default branch: naming it bases the workspace on the home working copy.
      const workspaceId = await createWorkspace(
        repoPath,
        branchName,
        effectiveParentBranch === defaultBranch
          ? undefined
          : effectiveParentBranch,
        metadata,
      );
      onCreated?.(workspaceId);

      // Step 6: Set target branch
      const updatedWorkspaces = await getWorkspaces(repoPath);
      const createdWorkspace = updatedWorkspaces.find(
        (w) => w.id === workspaceId,
      );

      if (createdWorkspace) {
        const fullPath = getFullWorkspacePath(createdWorkspace);
        await setWorkspaceTargetBranch(
          repoPath,
          fullPath,
          workspaceId,
          effectiveParentBranch,
        );
      }

      // Step 7: If "before", reparent the original workspace onto the new one
      if (position === "before" && currentParent) {
        const originalFullPath = getFullWorkspacePath(currentParent);
        await setWorkspaceTargetBranch(
          repoPath,
          originalFullPath,
          currentParent.id,
          branchName,
        );
      }

      // Step 8: Invalidate queries and notify success
      void invalidateQueries(["workspaces", activeRepoKey ?? repoPath]);
      void invalidateQueries(["workspace-statuses", activeRepoKey ?? repoPath]);

      addToast({
        title: "Stacked workspace created",
        description: `Created ${branchName} stacked on ${effectiveParentBranch}`,
        type: "success",
      });

      return workspaceId;
    } catch (error) {
      if (reportErrors) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        addToast({
          title: "Failed to create stacked workspace",
          description: errorMsg,
          type: "error",
        });
      }
      throw error;
    }
  };

  return { createStackedWorkspace };
}
