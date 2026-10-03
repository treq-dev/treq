import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useMemo, useState } from "react";
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
import { buildTaskColumn, dueFromDateInput } from "../../lib/google-tasks";
import { cn } from "../../lib/utils";
import { useToastStore } from "../../stores/toastStore";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { CreateLinearIssueDialog } from "./CreateLinearIssueDialog";
import { DRAG_TYPE, type DragPayload, TaskCardView } from "./TaskCardView";

const taskListKey = (listId: string) => ["google-tasks", listId];
import { errorText } from "../../lib/errorText";

/**
 * Google Tasks as a Kanban board: one column per task list, like the
 * Google Tasks web view. Cards drag between columns (moving the task to that
 * list) and onto another card (placing it after that card).
 */
export const GoogleTasksBoard: React.FC<{ repoPath: string }> = ({
  repoPath,
}) => {
  const { addToast } = useToastStore();
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
  const [linearTask, setLinearTask] = useState<GoogleTask | null>(null);

  const handleDrop = async (
    payload: DragPayload,
    destinationListId: string,
    previousTaskId?: string,
  ) => {
    if (previousTaskId === payload.taskId) return;
    try {
      await googleMoveTask({
        listId: payload.listId,
        taskId: payload.taskId,
        destinationListId,
        previousTaskId,
      });
      await refreshColumns(payload.listId, destinationListId);
    } catch (e) {
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
      <p className="p-6 text-sm text-destructive" role="alert">
        {errorText(error)}
      </p>
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
            onCreateLinearIssue={setLinearTask}
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
        task={linearTask}
        onClose={() => setLinearTask(null)}
        onLinked={(listId) => void refreshColumns(listId)}
      />
    </div>
  );
};

const TaskColumn: React.FC<{
  list: GoogleTaskList;
  onDrop: (payload: DragPayload, listId: string, previous?: string) => void;
  onCreateLinearIssue: (task: GoogleTask) => void;
}> = ({ list, onDrop, onCreateLinearIssue }) => {
  const { addToast } = useToastStore();
  const {
    data: tasks = [],
    isLoading,
    error,
    mutate,
  } = useSWR(taskListKey(list.id), () => googleListTasks(list.id), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const column = useMemo(() => buildTaskColumn(tasks), [tasks]);
  const [showCompleted, setShowCompleted] = useState(false);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [dragOver, setDragOver] = useState(false);

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

  const cardHandlers = {
    onToggle: (task: GoogleTask) =>
      run("Failed to update task", () =>
        googleUpdateTask(list.id, task.id, {
          status: task.status === "completed" ? "needsAction" : "completed",
        }),
      ),
    onDelete: (task: GoogleTask) =>
      run("Failed to delete task", () => googleDeleteTask(list.id, task.id)),
    onSetDue: (task: GoogleTask, value: string) =>
      run("Failed to update task", () =>
        googleUpdateTask(list.id, task.id, { due: dueFromDateInput(value) }),
      ),
    onDropOnCard: (e: React.DragEvent, target: GoogleTask) => {
      const payload = readPayload(e);
      if (payload) onDrop(payload, list.id, target.id);
    },
    onCreateLinearIssue,
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
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        setDragOver(false);
        const payload = readPayload(e);
        // Dropping on empty column space puts the task at the top.
        if (payload) onDrop(payload, list.id);
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
          <p className="text-xs text-destructive">{errorText(error)}</p>
        )}
        {column.open.map((card) => (
          <TaskCardView
            key={card.task.id}
            card={card}
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
                  listId={list.id}
                  {...cardHandlers}
                />
              ))}
          </>
        )}
      </div>
    </section>
  );
};
