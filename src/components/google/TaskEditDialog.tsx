import { useState } from "react";
import {
  googleCreateTask,
  googleUpdateTask,
  type GoogleTask,
} from "../../lib/api-google";
import { errorText } from "../../lib/errorText";
import { useToastStore } from "../../stores/toastStore";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

/**
 * Edits a task's title and notes, or (mode "subtask") creates a subtask
 * under it. Calls `onSaved` with the list to refetch.
 */
export const TaskEditDialog: React.FC<{
  mode: "edit" | "subtask";
  task: GoogleTask;
  onClose: () => void;
  onSaved: (listId: string) => void;
}> = ({ mode, task, onClose, onSaved }) => {
  const { addToast } = useToastStore();
  const editing = mode === "edit";
  const [title, setTitle] = useState(editing ? task.title : "");
  const [notes, setNotes] = useState(editing ? (task.notes ?? "") : "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      if (editing) {
        await googleUpdateTask(task.list_id, task.id, {
          title: trimmed,
          notes,
        });
      } else {
        await googleCreateTask(task.list_id, {
          title: trimmed,
          notes: notes || undefined,
          parent: task.id,
        });
      }
      onSaved(task.list_id);
      onClose();
    } catch (e) {
      addToast({
        title: editing ? "Failed to update task" : "Failed to add subtask",
        description: errorText(e),
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit task" : `Add subtask to “${task.title}”`}
          </DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Input
            autoFocus
            aria-label="Task title"
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Textarea
            aria-label="Task notes"
            placeholder="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !title.trim()}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
