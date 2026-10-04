import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import {
  googleCreateTask,
  googleCreateTaskList,
  googleDeleteTask,
  googleListTaskLists,
  googleListTasks,
  googleMoveTask,
  googleUpdateTask,
  type GoogleTask,
  type GoogleTaskList,
} from "../../lib/api-google";
import {
  buildTaskColumn,
  createLimiter,
  dueFromDateInput,
  isNotFoundError,
  taskKickoffPrompt,
} from "../../lib/google-tasks";
import type { Workspace } from "../../lib/api-types";
import {
  type IssueAttachment,
  issueFromGoogleTask,
} from "../../lib/promptAttachments";
import { errorText } from "../../lib/errorText";
import { cn } from "../../lib/utils";
import { useToastStore } from "../../stores/toastStore";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { CreateLinearIssueDialog } from "./CreateLinearIssueDialog";
import {
  DRAG_TYPE,
  type DragPayload,
  type TaskAction,
  TaskCardView,
} from "./TaskCardView";
import { TaskEditDialog } from "./TaskEditDialog";
import {
  LinkTaskWorkspaceDialog,
  useTaskWorkspaceLinks,
} from "./LinkTaskWorkspaceDialog";
import { GoogleErrorState } from "./GoogleErrorState";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";

const taskListKey = (listId: string) => ["google-tasks", listId];

/** Column fetches in flight at once, so 200 lists don't fire 200 requests. */
export const TASK_FETCH_CONCURRENCY = 4;
const limitFetch = createLimiter(TASK_FETCH_CONCURRENCY);
const fetchTasks = (listId: string) =>
  limitFetch(() => googleListTasks(listId));

/**
 * Google Tasks as a Kanban board: one column per task list, like the
 * Google Tasks web view. Cards drag between columns (moving the task to that
 * list) and onto another card (placing it after that card).
 */
export const GoogleTasksBoard: React.FC<{
  repoPath: string;
  /**
   * Opens the agent prompt with the task attached, like tracker kickoffs.
   * `prompt` carries the task's notes and open subtasks.
   */
  onKickoff: (issue: IssueAttachment, prompt: string) => void;
  /** Opens Settings on the Integrations tab, to reconnect Google. */
  onOpenSettings?: () => void;
}> = ({ repoPath, onKickoff, onOpenSettings }) => {
  const { addToast } = useToastStore();
  const { workspaces, linked, unlink } = useTaskWorkspaceLinks(repoPath);

  const {
    data: lists,
    error,
    isLoading,
    mutate: refetchLists,
  } = useSWR(["google-task-lists"], googleListTaskLists, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const { mutate } = useSWRConfig();
  // Refetch only the columns an action touched.
  const refreshColumns = (...listIds: string[]) =>
    Promise.all(listIds.map((id) => mutate(taskListKey(id))));
  const [newListTitle, setNewListTitle] = useState("");
  const [dialog, setDialog] = useState<{
    action: Exclude<TaskAction, "kickoff" | "unlink">;
    task: GoogleTask;
  } | null>(null);

  const handleDrop = async (
    payload: DragPayload,
    destinationListId: string,
    previousTaskId?: string,
  ) => {
    if (previousTaskId === payload.taskId) return;
    try {
      const { failed_subtask_ids: failed } = await googleMoveTask({
        listId: payload.listId,
        taskId: payload.taskId,
        destinationListId,
        previousTaskId,
      });
      if (failed.length > 0) {
        addToast({
          title: `${failed.length} subtask${failed.length === 1 ? "" : "s"} could not be moved`,
          description: "They stay in the original list.",
          type: "warning",
        });
      }
      await refreshColumns(payload.listId, destinationListId);
    } catch (e) {
      void refreshColumns(payload.listId, destinationListId);
      addToast({
        title: "Failed to move task",
        description: errorText(e),
        type: "error",
      });
    }
  };

  const handleCreateList = async () => {
    const title = newListTitle.trim();
    if (!title) return;
    try {
      await googleCreateTaskList(title);
      setNewListTitle("");
      await refetchLists();
    } catch (e) {
      addToast({
        title: "Failed to create list",
        description: errorText(e),
        type: "error",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading task lists…
      </div>
    );
  }
  if (error) {
    return (
      <GoogleErrorState
        error={error}
        onRetry={() => void refetchLists()}
        onOpenSettings={onOpenSettings}
      />
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex justify-end px-4 pb-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void refetchLists();
            void refreshColumns(...(lists ?? []).map((l) => l.id));
          }}
          aria-label="Refresh tasks"
        >
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>
      <div
        className="flex gap-3 overflow-x-auto px-4 pb-4 flex-1 min-h-0"
        data-testid="google-tasks-board"
      >
        {(lists ?? []).map((list) => (
          <TaskColumn
            key={list.id}
            list={list}
            onDrop={handleDrop}
            linked={linked}
            onKickoff={onKickoff}
            onAction={(action, task) =>
              action === "unlink"
                ? void unlink(task)
                : setDialog({ action, task })
            }
            onOpenSettings={onOpenSettings}
          />
        ))}
        <div className="flex-shrink-0 w-72 p-3 rounded-lg border border-dashed border-border h-fit">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreateList();
            }}
          >
            <Input
              value={newListTitle}
              onChange={(e) => setNewListTitle(e.target.value)}
              placeholder="New list"
              aria-label="New list title"
            />
            <Button type="submit" size="sm" variant="outline">
              <Plus className="w-4 h-4" />
            </Button>
          </form>
        </div>
      </div>
      <CreateLinearIssueDialog
        repoPath={repoPath}
        task={dialog?.action === "linear" ? dialog.task : null}
        onClose={() => setDialog(null)}
        onLinked={(listId) => void refreshColumns(listId)}
      />
      <LinkTaskWorkspaceDialog
        repoPath={repoPath}
        task={dialog?.action === "link" ? dialog.task : null}
        workspaces={workspaces}
        onClose={() => setDialog(null)}
      />
      {(dialog?.action === "edit" || dialog?.action === "subtask") && (
        <TaskEditDialog
          key={`${dialog.action}:${dialog.task.id}`}
          mode={dialog.action}
          task={dialog.task}
          onClose={() => setDialog(null)}
          onSaved={(listId) => void refreshColumns(listId)}
        />
      )}
    </div>
  );
};

const TaskColumn: React.FC<{
  list: GoogleTaskList;
  onDrop: (payload: DragPayload, listId: string, previous?: string) => void;
  linked: Map<string, Workspace>;
  onKickoff: (issue: IssueAttachment, prompt: string) => void;
  onAction: (action: Exclude<TaskAction, "kickoff">, task: GoogleTask) => void;
  onOpenSettings?: () => void;
}> = ({ list, linked, onDrop, onKickoff, onAction, onOpenSettings }) => {
  const { addToast } = useToastStore();
  const {
    data: tasks = [],
    isLoading,
    error,
    mutate,
  } = useSWR(taskListKey(list.id), () => fetchTasks(list.id), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const column = useMemo(() => buildTaskColumn(tasks), [tasks]);
  // Handlers read the newest cache, not the copy a card rendered with.
  const latestTasks = useRef(tasks);
  useEffect(() => {
    latestTasks.current = tasks;
  }, [tasks]);
  /** Tasks with a toggle or delete in flight; a second click is ignored. */
  const pending = useRef(new Set<string>());
  const [confirmDelete, setConfirmDelete] = useState<{
    task: GoogleTask;
    subtaskCount: number;
  } | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [dragOver, setDragOver] = useState(false);
  // A card's drop handler stops propagation and a drag can end anywhere, so
  // clear the highlight on any drop or drag end, not only this column's.
  useEffect(() => {
    if (!dragOver) return;
    const clear = () => setDragOver(false);
    window.addEventListener("dragend", clear, true);
    window.addEventListener("drop", clear, true);
    return () => {
      window.removeEventListener("dragend", clear, true);
      window.removeEventListener("drop", clear, true);
    };
  }, [dragOver]);

  const run = async (label: string, action: () => Promise<unknown>) => {
    try {
      await action();
      await mutate();
    } catch (e) {
      addToast({ title: label, description: errorText(e), type: "error" });
    }
  };

  const readPayload = (e: React.DragEvent): DragPayload | null => {
    try {
      return JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as DragPayload;
    } catch {
      return null;
    }
  };

  const guarded = async (taskId: string, action: () => Promise<void>) => {
    if (pending.current.has(taskId)) return;
    pending.current.add(taskId);
    try {
      await action();
    } finally {
      pending.current.delete(taskId);
    }
  };

  const deleteTask = (task: GoogleTask) =>
    guarded(task.id, () =>
      run("Failed to delete task", async () => {
        try {
          await googleDeleteTask(list.id, task.id);
        } catch (e) {
          // Already gone (deleted elsewhere): that is what the user wanted.
          if (!isNotFoundError(e)) throw e;
        }
      }),
    );

  const cardHandlers = {
    onToggle: (task: GoogleTask) =>
      guarded(task.id, () =>
        run("Failed to update task", () => {
          const current =
            latestTasks.current.find((t) => t.id === task.id) ?? task;
          return googleUpdateTask(list.id, task.id, {
            status:
              current.status === "completed" ? "needsAction" : "completed",
          });
        }),
      ),
    onDelete: (task: GoogleTask) => {
      const card = [...column.open, ...column.completed].find(
        (c) => c.task.id === task.id,
      );
      const subtaskCount =
        card?.subtasks.length ??
        latestTasks.current.filter((t) => t.parent === task.id).length;
      setConfirmDelete({ task, subtaskCount });
    },
    onSetDue: (task: GoogleTask, value: string) =>
      run("Failed to update task", () =>
        googleUpdateTask(list.id, task.id, { due: dueFromDateInput(value) }),
      ),
    onDropOnCard: (e: React.DragEvent, target: GoogleTask) => {
      const payload = readPayload(e);
      if (payload) onDrop(payload, list.id, target.id);
    },
    onAction: (action: TaskAction, task: GoogleTask) => {
      if (action !== "kickoff") return onAction(action, task);
      // The card's own subtasks: deduped, grandchildren included.
      const card = [...column.open, ...column.completed].find(
        (c) => c.task.id === task.id,
      );
      onKickoff(
        issueFromGoogleTask({
          listId: list.id,
          taskId: task.id,
          title: task.title,
          url: task.web_link,
        }),
        taskKickoffPrompt(task, card?.subtasks ?? []),
      );
    },
  };

  return (
    <section
      aria-label={list.title}
      data-testid={`google-task-column-${list.id}`}
      className={cn(
        "flex-shrink-0 w-80 bg-muted/30 rounded-lg border border-border p-3 flex flex-col max-h-full",
        dragOver && "ring-2 ring-primary/50",
      )}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DRAG_TYPE)) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        // Moving between the column's own children fires dragleave too.
        const next = e.relatedTarget as Node | null;
        if (!next || !e.currentTarget.contains(next)) setDragOver(false);
      }}
      onDropCapture={() => setDragOver(false)}
      onDrop={(e) => {
        const payload = readPayload(e);
        if (!payload) return;
        // A top-level task dropped on its own column's empty space stays put.
        const own = tasks.find((t) => t.id === payload.taskId);
        if (payload.listId === list.id && own && !own.parent) return;
        // Otherwise empty column space puts the task at the top.
        onDrop(payload, list.id);
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-medium text-sm">{list.title}</h3>
        <span className="text-xs text-muted-foreground">
          {column.open.length}
        </span>
      </div>

      {adding ? (
        <form
          className="mb-2"
          onSubmit={(e) => {
            e.preventDefault();
            const value = title.trim();
            if (!value) return;
            setTitle("");
            void run("Failed to create task", () =>
              googleCreateTask(list.id, { title: value }),
            );
          }}
        >
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => !title && setAdding(false)}
            onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
            placeholder="Title"
            aria-label={`New task in ${list.title}`}
          />
        </form>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="justify-start gap-2 mb-2 text-primary"
          onClick={() => setAdding(true)}
        >
          <Plus className="w-4 h-4" /> Add a task
        </Button>
      )}

      <div className="flex-1 overflow-y-auto flex flex-col gap-2 min-h-8">
        {isLoading && (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        )}
        {error && (
          <GoogleErrorState
            className="space-y-2"
            error={error}
            onRetry={() => void mutate()}
            onOpenSettings={onOpenSettings}
          />
        )}
        {column.open.map((card) => (
          <TaskCardView
            key={card.task.id}
            card={card}
            linkedWorkspace={linked.get(card.task.id)}
            listId={list.id}
            {...cardHandlers}
          />
        ))}
        {column.completed.length > 0 && (
          <>
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-muted-foreground mt-2"
              onClick={() => setShowCompleted((v) => !v)}
            >
              {showCompleted ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
              Completed ({column.completed.length})
            </button>
            {showCompleted &&
              column.completed.map((card) => (
                <TaskCardView
                  key={card.task.id}
                  card={card}
                  linkedWorkspace={linked.get(card.task.id)}
                  listId={list.id}
                  {...cardHandlers}
                />
              ))}
          </>
        )}
      </div>
      <AlertDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete task?</AlertDialogTitle>
            <AlertDialogDescription>
              {`“${confirmDelete?.task.title || "(untitled)"}” is deleted from Google Tasks.`}
              {confirmDelete && confirmDelete.subtaskCount > 0
                ? ` Its ${confirmDelete.subtaskCount} subtask${confirmDelete.subtaskCount === 1 ? " is" : "s are"} deleted too.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = confirmDelete?.task;
                setConfirmDelete(null);
                if (target) void deleteTask(target);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};
