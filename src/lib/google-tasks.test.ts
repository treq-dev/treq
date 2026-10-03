import { describe, expect, it } from "vitest";
import type { GoogleTask } from "./api-google";
import {
  buildTaskColumn,
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
