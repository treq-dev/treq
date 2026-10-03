import type { GoogleTask } from "./api-google";

export type TaskCard = {
  task: GoogleTask;
  subtasks: GoogleTask[];
};

export type TaskColumnCards = {
  open: TaskCard[];
  completed: TaskCard[];
};

/**
 * Splits one list's tasks into the cards a Kanban column shows: top-level
 * tasks with their subtasks nested under them, open ones first in Google's
 * order, completed ones in a separate group like the Google Tasks UI.
 * A subtask whose parent is missing is shown as its own card.
 */
export function buildTaskColumn(tasks: GoogleTask[]): TaskColumnCards {
  const ids = new Set(tasks.map((t) => t.id));
  const byPosition = [...tasks].sort((a, b) =>
    a.position.localeCompare(b.position),
  );
  const subtasks = new Map<string, GoogleTask[]>();
  const cards: TaskCard[] = [];
  for (const task of byPosition) {
    if (task.parent && ids.has(task.parent)) {
      const siblings = subtasks.get(task.parent) ?? [];
      siblings.push(task);
      subtasks.set(task.parent, siblings);
    } else {
      cards.push({ task, subtasks: [] });
    }
  }
  for (const card of cards) {
    card.subtasks = subtasks.get(card.task.id) ?? [];
  }
  return {
    open: cards.filter((c) => c.task.status !== "completed"),
    completed: cards.filter((c) => c.task.status === "completed"),
  };
}

/** Google stores only the date part of `due`; show it without a timezone shift. */
export function formatDue(due: string | null): string | null {
  if (!due) return null;
  const [year, month, day] = due.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** `YYYY-MM-DD` from a date input, as the RFC 3339 value the Tasks API wants. */
export function dueFromDateInput(value: string): string {
  return value ? `${value}T00:00:00.000Z` : "";
}

/** Appends a Linear issue link to a task's notes, once. */
export function notesWithLinearLink(
  notes: string | null,
  identifier: string,
  url: string,
): string {
  const current = notes?.trim() ?? "";
  if (current.includes(url)) return current;
  const line = `Linear: ${identifier} ${url}`;
  return current ? `${current}\n\n${line}` : line;
}
