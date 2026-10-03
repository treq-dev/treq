import { Loader2 } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { googleUpdateTask, type GoogleTask } from "../../lib/api-google";
import { linearCreateIssue, linearListTeams } from "../../lib/api-linear";
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

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Creates a Linear issue from a task and links it in the task&apos;s notes. */
export const CreateLinearIssueDialog: React.FC<{
  repoPath: string;
  task: GoogleTask | null;
  onClose: () => void;
  onCreated: () => void;
}> = ({ repoPath, task, onClose, onCreated }) => {
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
    try {
      const issue = await linearCreateIssue({
        repoPath,
        teamId,
        title: task.title,
        description: task.notes ?? undefined,
      });
      await googleUpdateTask(task.list_id, task.id, {
        notes: notesWithLinearLink(task.notes, issue.identifier, issue.url),
      });
      addToast({
        title: `Created ${issue.identifier}`,
        description: task.title,
        type: "success",
      });
      onCreated();
      onClose();
    } catch (e) {
      addToast({
        title: "Failed to create Linear issue",
        description: errorText(e),
        type: "error",
      });
    } finally {
      setCreating(false);
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
