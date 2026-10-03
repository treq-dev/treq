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
 *
 * No task is ever dropped, whatever the API returns:
 * - duplicate ids keep their first copy;
 * - a missing position sorts last;
 * - a subtask whose parent is missing, itself, or part of a parent cycle is
 *   shown as its own card;
 * - a grandchild nests under its top-level ancestor (cards are one level deep);
 * - an open subtask under a completed task is shown as its own open card, so
 *   it does not hide in the collapsed Completed group.
 */
export function buildTaskColumn(tasks: GoogleTask[]): TaskColumnCards {
  const byId = new Map<string, GoogleTask>();
  for (const task of tasks) if (!byId.has(task.id)) byId.set(task.id, task);
  const unique = [...byId.values()];
  const order = new Map(unique.map((t, i) => [t.id, i]));
  const byPosition = unique.sort((a, b) => {
    const pa = a.position ?? null;
    const pb = b.position ?? null;
    if (pa !== pb) {
      if (pa === null) return 1;
      if (pb === null) return -1;
      return pa < pb ? -1 : 1;
    }
    return order.get(a.id)! - order.get(b.id)!;
  });

  /** The top-level ancestor, or the task itself when its chain is broken. */
  const rootOf = (task: GoogleTask): GoogleTask => {
    const seen = new Set([task.id]);
    let current = task;
    for (;;) {
      const parent = current.parent ? byId.get(current.parent) : undefined;
      if (!parent || parent.id === current.id) return current;
      if (seen.has(parent.id)) return task; // cycle
      seen.add(parent.id);
      current = parent;
    }
  };

  const subtasks = new Map<string, GoogleTask[]>();
  const cards: TaskCard[] = [];
  for (const task of byPosition) {
    const root = rootOf(task);
    const promoted = root.status === "completed" && task.status !== "completed";
    if (root.id === task.id || promoted) {
      cards.push({ task, subtasks: [] });
    } else {
      const siblings = subtasks.get(root.id) ?? [];
      siblings.push(task);
      subtasks.set(root.id, siblings);
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

/** Prompt that kicks off an agent from a task, like tracker kickoffs do. */
export function taskKickoffPrompt(
  task: GoogleTask,
  subtasks: GoogleTask[],
): string {
  const parts = [task.title.trim()];
  if (task.notes?.trim()) parts.push(task.notes.trim());
  const open = subtasks.filter((s) => s.status !== "completed");
  if (open.length > 0) {
    parts.push(`Steps:\n${open.map((s) => `- ${s.title}`).join("\n")}`);
  }
  return parts.join("\n\n");
}
