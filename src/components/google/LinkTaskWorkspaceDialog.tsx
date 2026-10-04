import { useMemo, useState } from "react";
import useSWR from "swr";
import { getWorkspaces } from "../../lib/api";
import { useRepositoryCacheKey } from "../../lib/active-repository-context";
import {
  googleLinkTaskToWorkspace,
  googleUnlinkTask,
  type GoogleTask,
} from "../../lib/api-google";
import { linkedWorkspacesByTask } from "../../lib/google-tasks";
import type { Workspace } from "../../lib/api-types";
import { errorText } from "../../lib/errorText";
import { invalidateQueries } from "../../lib/swr-cache";
import { useToastStore } from "../../stores/toastStore";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

export const workspaceLabel = (workspace: Workspace) =>
  workspace.title?.trim() || workspace.branch_name;

/**
 * The repository's workspaces, which task each is linked to (from workspace
 * metadata), and an unlink action for a task's card.
 */
export function useTaskWorkspaceLinks(repoPath: string) {
  const { addToast } = useToastStore();
  const cacheKey = useRepositoryCacheKey(repoPath);
  const { data: workspaces = [] } = useSWR(
    cacheKey ? ["workspaces", cacheKey] : null,
    () => getWorkspaces(repoPath),
    { keepPreviousData: true },
  );
  const linked = useMemo(
    () => linkedWorkspacesByTask(workspaces),
    [workspaces],
  );

  const unlink = async (task: GoogleTask) => {
    const workspace = linked.get(task.id);
    if (!workspace) return;
    try {
      await googleUnlinkTask(repoPath, workspace.id);
      void invalidateQueries(["workspaces"]);
      addToast({
        title: `Unlinked from ${workspaceLabel(workspace)}`,
        description: task.title,
        type: "success",
      });
    } catch (e) {
      addToast({
        title: "Failed to unlink task",
        description: errorText(e),
        type: "error",
      });
    }
  };

  return { workspaces, linked, unlink };
}

/** Links a Google Task to one of the repository's workspaces. */
export const LinkTaskWorkspaceDialog: React.FC<{
  repoPath: string;
  task: GoogleTask | null;
  workspaces: Workspace[];
  onClose: () => void;
}> = ({ repoPath, task, workspaces, onClose }) => {
  const { addToast } = useToastStore();
  const [linking, setLinking] = useState(false);
  const choices = workspaces.filter((w) => !w.archived);

  const link = async (workspace: Workspace) => {
    if (!task) return;
    setLinking(true);
    try {
      await googleLinkTaskToWorkspace({
        repoPath,
        workspaceId: workspace.id,
        listId: task.list_id,
        taskId: task.id,
      });
      void invalidateQueries(["workspaces"]);
      addToast({
        title: `Linked to ${workspaceLabel(workspace)}`,
        description: task.title,
        type: "success",
      });
      onClose();
    } catch (e) {
      addToast({
        title: "Failed to link task",
        description: errorText(e),
        type: "error",
      });
    } finally {
      setLinking(false);
    }
  };

  return (
    <Dialog open={task !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link to workspace</DialogTitle>
          <DialogDescription>
            Pick the workspace for “{task?.title}”. Merging its pull request marks the task
            complete.
          </DialogDescription>
        </DialogHeader>
        {choices.length === 0 && (
          <p className="text-sm text-muted-foreground">
            This repository has no workspaces yet.
          </p>
        )}
        <div className="flex flex-col gap-1 max-h-80 overflow-y-auto">
          {choices.map((workspace) => (
            <Button
              key={workspace.id}
              variant="outline"
              disabled={linking}
              className="justify-start"
              onClick={() => void link(workspace)}
            >
              <span className="truncate">{workspaceLabel(workspace)}</span>
              {workspace.title?.trim() && (
                <span className="ml-2 font-mono text-xs text-muted-foreground truncate">
                  {workspace.branch_name}
                </span>
              )}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};
