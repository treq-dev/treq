import { describe, expect, it } from "vitest";
import type { GoogleTask } from "./api-google";
import type { Workspace } from "./api-types";
import {
  buildTaskColumn,
  linkedWorkspacesByTask,
  taskKickoffPrompt,
  createLimiter,
  isNotFoundError,
  isValidDueInput,
  KICKOFF_NOTES_LIMIT,
  dueFromDateInput,
  formatDue,
  notesWithLinearLink,
} from "./google-tasks";

const task = (overrides: Partial<GoogleTask>): GoogleTask => ({
  id: "t",
  list_id: "L",
  title: "T",
  notes: null,
  status: "needsAction",
  due: null,
  parent: null,
  position: "0",
  web_link: null,
  ...overrides,
});

describe("buildTaskColumn", () => {
  it("nests subtasks and separates completed tasks", () => {
    const column = buildTaskColumn([
      task({ id: "b", position: "2" }),
      task({ id: "a", position: "1" }),
      task({ id: "a1", parent: "a", position: "0" }),
      task({ id: "done", status: "completed", position: "3" }),
      task({ id: "orphan", parent: "missing", position: "4" }),
    ]);
    expect(column.open.map((c) => c.task.id)).toEqual(["a", "b", "orphan"]);
    expect(column.open[0].subtasks.map((t) => t.id)).toEqual(["a1"]);
    expect(column.completed.map((c) => c.task.id)).toEqual(["done"]);
  });

  const ids = (cards: { task: GoogleTask }[]) => cards.map((c) => c.task.id);

  it("sorts tasks without a position last and keeps every task", () => {
    const column = buildTaskColumn([
      task({ id: "none", position: null as unknown as string }),
      task({ id: "a", position: "1" }),
    ]);
    expect(ids(column.open)).toEqual(["a", "none"]);
  });

  it("shows self-parented and cyclic tasks as their own cards", () => {
    const column = buildTaskColumn([
      task({ id: "self", parent: "self", position: "1" }),
      task({ id: "x", parent: "y", position: "2" }),
      task({ id: "y", parent: "x", position: "3" }),
    ]);
    expect(ids(column.open)).toEqual(["self", "x", "y"]);
    expect(column.open.every((c) => c.subtasks.length === 0)).toBe(true);
  });

  it("nests a grandchild under its top-level ancestor", () => {
    const column = buildTaskColumn([
      task({ id: "a", position: "1" }),
      task({ id: "a1", parent: "a", position: "2" }),
      task({ id: "a11", parent: "a1", position: "3" }),
    ]);
    expect(ids(column.open)).toEqual(["a"]);
    expect(column.open[0].subtasks.map((t) => t.id)).toEqual(["a1", "a11"]);
  });

  it("promotes an open subtask of a completed task to an open card", () => {
    const column = buildTaskColumn([
      task({ id: "p", status: "completed", position: "1" }),
      task({ id: "open", parent: "p", position: "2" }),
      task({ id: "closed", parent: "p", status: "completed", position: "3" }),
    ]);
    expect(ids(column.open)).toEqual(["open"]);
    expect(ids(column.completed)).toEqual(["p"]);
    expect(column.completed[0].subtasks.map((t) => t.id)).toEqual(["closed"]);
  });

  it("drops duplicate ids", () => {
    const column = buildTaskColumn([
      task({ id: "a", title: "first" }),
      task({ id: "a", title: "second" }),
    ]);
    expect(column.open.map((c) => c.task.title)).toEqual(["first"]);
  });
});

describe("due dates", () => {
  it("round-trips a date input", () => {
    expect(dueFromDateInput("2026-10-03")).toBe("2026-10-03T00:00:00.000Z");
    expect(dueFromDateInput("")).toBe("");
    expect(formatDue("2026-10-03T00:00:00.000Z")).toContain("3");
    expect(formatDue(null)).toBeNull();
  });
});

describe("notesWithLinearLink", () => {
  it("appends the link once", () => {
    const url = "https://linear.app/x/issue/ENG-1";
    const once = notesWithLinearLink("Some notes", "ENG-1", url);
    expect(once).toBe(`Some notes\n\nLinear: ENG-1 ${url}`);
    expect(notesWithLinearLink(once, "ENG-1", url)).toBe(once);
    expect(notesWithLinearLink(null, "ENG-1", url)).toBe(
      `Linear: ENG-1 ${url}`,
    );
  });
});

describe("taskKickoffPrompt", () => {
  it("uses title, notes and open subtasks", () => {
    expect(
      taskKickoffPrompt(task({ title: "Ship it", notes: "Before Friday" }), [
        task({ id: "s1", title: "Write tests" }),
        task({ id: "s2", title: "Done already", status: "completed" }),
      ]),
    ).toBe("Ship it\n\nBefore Friday\n\nSteps:\n- Write tests");
  });
});

describe("taskKickoffPrompt limits", () => {
  it("names an untitled task and skips blank steps", () => {
    expect(
      taskKickoffPrompt(task({ title: "  ", notes: "  " }), [
        task({ id: "s1", title: " " }),
        task({ id: "s2", title: "Real step" }),
      ]),
    ).toBe("(untitled task)\n\nSteps:\n- Real step");
  });

  it("caps notes and steps", () => {
    const prompt = taskKickoffPrompt(
      task({ notes: "x".repeat(KICKOFF_NOTES_LIMIT + 10) }),
      Array.from({ length: 60 }, (_, i) =>
        task({ id: `s${i}`, title: `S${i}` }),
      ),
    );
    expect(prompt).toContain("(notes truncated)");
    expect(prompt).not.toContain("x".repeat(KICKOFF_NOTES_LIMIT + 1));
    expect(prompt).toContain("- S49\n- …and 10 more");
    expect(prompt).not.toContain("- S50");
  });

  it("includes grandchildren from the card built by buildTaskColumn", () => {
    const { open } = buildTaskColumn([
      task({ id: "a", title: "A", position: "1" }),
      task({ id: "a1", title: "Child", parent: "a", position: "2" }),
      task({ id: "a2", title: "Grandchild", parent: "a1", position: "3" }),
      task({ id: "a1", title: "Duplicate", parent: "a", position: "4" }),
    ]);
    expect(taskKickoffPrompt(open[0].task, open[0].subtasks)).toBe(
      "A\n\nSteps:\n- Child\n- Grandchild",
    );
  });
});

describe("isValidDueInput", () => {
  it("accepts full dates from 1970 on", () => {
    expect(isValidDueInput("2026-10-04")).toBe(true);
    expect(isValidDueInput("0002-10-04")).toBe(false);
    expect(isValidDueInput("1969-12-31")).toBe(false);
    expect(isValidDueInput("2026-02-30")).toBe(false);
    expect(isValidDueInput("")).toBe(false);
  });
});

describe("isNotFoundError", () => {
  it("matches 404 and not-found messages", () => {
    expect(isNotFoundError("Google API error 404: gone")).toBe(true);
    expect(isNotFoundError(new Error("Comment not found"))).toBe(true);
    expect(isNotFoundError("500 internal")).toBe(false);
  });
});

describe("createLimiter", () => {
  it("never runs more than the limit at once", async () => {
    const limit = createLimiter(2);
    let active = 0;
    let peak = 0;
    const job = () =>
      limit(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 1));
        active--;
      });
    await Promise.all(Array.from({ length: 6 }, job));
    expect(peak).toBe(2);
  });
});

describe("linkedWorkspacesByTask", () => {
  const ws = (id: number, metadata?: string, archived = false): Workspace =>
    ({ id, metadata, archived }) as Workspace;

  it("maps task ids to live workspaces and ignores bad metadata", () => {
    const linked = linkedWorkspacesByTask([
      ws(1, JSON.stringify({ google_task_id: "t1", google_tasklist_id: "l" })),
      ws(2, JSON.stringify({ google_task_id: "t2" }), true),
      ws(3, "not json"),
      ws(4),
      ws(5, JSON.stringify({ google_task_id: "t1" })),
    ]);
    expect([...linked.entries()].map(([k, w]) => [k, w.id])).toEqual([
      ["t1", 1],
    ]);
  });
});
