import { CheckCircle2, Circle, ExternalLink, MoreVertical } from "lucide-react";
import { useState } from "react";
import type { GoogleTask } from "../../lib/api-google";
import { formatDue, type TaskCard } from "../../lib/google-tasks";
import { cn } from "../../lib/utils";
import { usePreviewFeature } from "../../stores/featurePreviewStore";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

export const DRAG_TYPE = "application/x-treq-google-task";

export type DragPayload = { listId: string; taskId: string };

export const TaskCardView: React.FC<{
  card: TaskCard;
  listId: string;
  onToggle: (task: GoogleTask) => void;
  onDelete: (task: GoogleTask) => void;
  onSetDue: (task: GoogleTask, value: string) => void;
  onDropOnCard: (e: React.DragEvent, target: GoogleTask) => void;
  onCreateLinearIssue: (task: GoogleTask) => void;
}> = ({
  card,
  listId,
  onToggle,
  onDelete,
  onSetDue,
  onDropOnCard,
  onCreateLinearIssue,
}) => {
  const { task, subtasks } = card;
  const [editingDue, setEditingDue] = useState(false);
  const linearIntegration = usePreviewFeature("linearIntegration");
  const done = task.status === "completed";
  const due = formatDue(task.due);
  return (
    <div
      draggable={!done}
      onDragStart={(e) =>
        e.dataTransfer.setData(
          DRAG_TYPE,
          JSON.stringify({ listId, taskId: task.id } satisfies DragPayload),
        )
      }
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DRAG_TYPE)) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDropOnCard(e, task);
      }}
      data-testid={`google-task-${task.id}`}
      className="bg-background border border-border rounded-md p-2.5 text-sm"
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-label={
            done ? `Mark ${task.title} incomplete` : `Complete ${task.title}`
          }
          onClick={() => onToggle(task)}
          className="mt-0.5 text-muted-foreground hover:text-primary"
        >
          {done ? (
            <CheckCircle2 className="w-4 h-4 text-primary" />
          ) : (
            <Circle className="w-4 h-4" />
          )}
        </button>
        <div className="flex-1 min-w-0">
          <p
            className={cn(
              "font-medium break-words",
              done && "line-through text-muted-foreground",
            )}
          >
            {task.title || "(untitled)"}
          </p>
          {task.notes && (
            <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap line-clamp-3 break-words">
              {task.notes}
            </p>
          )}
          {editingDue ? (
            <input
              type="date"
              autoFocus
              aria-label={`Due date for ${task.title}`}
              defaultValue={task.due?.slice(0, 10) ?? ""}
              className="mt-1 text-xs bg-background border border-border rounded px-1"
              onBlur={() => setEditingDue(false)}
              onChange={(e) => {
                setEditingDue(false);
                onSetDue(task, e.target.value);
              }}
            />
          ) : (
            due && (
              <span className="inline-block text-xs mt-1 px-1.5 py-0.5 rounded border border-border">
                {due}
              </span>
            )
          )}
          {subtasks.length > 0 && (
            <ul className="mt-2 space-y-1">
              {subtasks.map((sub) => (
                <li key={sub.id} className="flex items-center gap-1.5 text-xs">
                  <button
                    type="button"
                    aria-label={`Toggle ${sub.title}`}
                    onClick={() => onToggle(sub)}
                  >
                    {sub.status === "completed" ? (
                      <CheckCircle2 className="w-3 h-3 text-primary" />
                    ) : (
                      <Circle className="w-3 h-3 text-muted-foreground" />
                    )}
                  </button>
                  <span
                    className={cn(
                      sub.status === "completed" &&
                        "line-through text-muted-foreground",
                    )}
                  >
                    {sub.title}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Actions for ${task.title}`}
              className="text-muted-foreground hover:text-foreground"
            >
              <MoreVertical className="w-4 h-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {linearIntegration && (
              <DropdownMenuItem onSelect={() => onCreateLinearIssue(task)}>
                Create Linear issue
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => setEditingDue(true)}>
              Set due date
            </DropdownMenuItem>
            {task.web_link && (
              <DropdownMenuItem
                onSelect={() => window.open(task.web_link ?? "", "_blank")}
              >
                <ExternalLink className="w-3 h-3 mr-2" /> Open in Google Tasks
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              className="text-destructive"
              onSelect={() => onDelete(task)}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};
