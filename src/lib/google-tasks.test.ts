import { describe, expect, it } from "vitest";
import type { GoogleTask } from "./api-google";
import {
  buildTaskColumn,
  taskKickoffPrompt,
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
