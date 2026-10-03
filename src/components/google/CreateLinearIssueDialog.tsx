import { Loader2 } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { googleUpdateTask, type GoogleTask } from "../../lib/api-google";
import {
  linearCreateIssue,
  linearListTeams,
  type LinearCreatedIssue,
} from "../../lib/api-linear";
import { notesWithLinearLink } from "../../lib/google-tasks";
import { useToastStore } from "../../stores/toastStore";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { errorText } from "../../lib/errorText";

/** Creates a Linear issue from a task and links it in the task's notes. */
export const CreateLinearIssueDialog: React.FC<{
  repoPath: string;
  task: GoogleTask | null;
  onClose: () => void;
  /** Called with the task's list once its notes carry the issue link. */
  onLinked: (listId: string) => void;
}> = ({ repoPath, task, onClose, onLinked }) => {
  const { addToast } = useToastStore();
  const [creating, setCreating] = useState(false);
  const { data: teams, error } = useSWR(
    task ? ["linear-teams", repoPath] : null,
    () => linearListTeams(repoPath),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const create = async (teamId: string) => {
    if (!task) return;
    setCreating(true);
    let issue: LinearCreatedIssue;
    try {
      issue = await linearCreateIssue({
        repoPath,
        teamId,
        title: task.title,
        description: task.notes ?? undefined,
      });
    } catch (e) {
      addToast({
        title: "Failed to create Linear issue",
        description: errorText(e),
        type: "error",
      });
      setCreating(false);
      return;
    }
    // The issue exists from here on: close the dialog whatever happens next,
    // so a retry cannot create a second one.
    onClose();
    setCreating(false);
    try {
      await googleUpdateTask(task.list_id, task.id, {
        notes: notesWithLinearLink(task.notes, issue.identifier, issue.url),
      });
      addToast({
        title: `Created ${issue.identifier}`,
        description: task.title,
        type: "success",
      });
      onLinked(task.list_id);
    } catch (e) {
      addToast({
        title: `Created ${issue.identifier}, but could not link the task`,
        description: `${issue.url} — ${errorText(e)}`,
        type: "warning",
      });
    }
  };

  return (
    <Dialog open={task !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Linear issue</DialogTitle>
          <DialogDescription>
            Pick the team for “{task?.title}”. The issue link is added to the
            task&apos;s notes.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p className="text-sm text-destructive">{errorText(error)}</p>
        )}
        {!teams && !error && <Loader2 className="w-4 h-4 animate-spin" />}
        <div className="flex flex-col gap-1">
          {(teams ?? []).map((team) => (
            <Button
              key={team.id}
              variant="outline"
              disabled={creating}
              className="justify-start"
              onClick={() => void create(team.id)}
            >
              <span className="font-mono text-xs mr-2">{team.key}</span>
              {team.name}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};
