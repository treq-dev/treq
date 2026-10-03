import userEvent from "@testing-library/user-event";
import { fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "../../../test/test-utils";
import type { GoogleTask } from "../../lib/api-google";
import { GoogleTasksBoard } from "./GoogleTasksBoard";

const api = vi.hoisted(() => ({
  googleListTaskLists: vi.fn(),
  googleListTasks: vi.fn(),
  googleCreateTask: vi.fn(),
  googleUpdateTask: vi.fn(),
  googleMoveTask: vi.fn(),
  googleDeleteTask: vi.fn(),
  googleCreateTaskList: vi.fn(),
}));

vi.mock("../../lib/api-google", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api-google")>()),
  ...api,
}));

const task = (overrides: Partial<GoogleTask>): GoogleTask => ({
  id: "t1",
  list_id: "inbox",
  title: "Write spec",
  notes: null,
  status: "needsAction",
  due: null,
  parent: null,
  position: "1",
  web_link: null,
  ...overrides,
});

const onKickoff = vi.fn();

describe("GoogleTasksBoard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.googleListTaskLists.mockResolvedValue([
      { id: "inbox", title: "Inbox" },
      { id: "doing", title: "Doing" },
    ]);
    api.googleListTasks.mockImplementation(async (listId: string) =>
      listId === "inbox"
        ? [
            task({}),
            task({ id: "done", title: "Old task", status: "completed" }),
            task({ id: "sub", title: "Draft outline", parent: "t1" }),
          ]
        : [],
    );
    api.googleCreateTask.mockResolvedValue(task({ id: "new" }));
    api.googleUpdateTask.mockResolvedValue(task({}));
    api.googleMoveTask.mockResolvedValue(task({ list_id: "doing" }));
  });

  it("shows one column per task list with completed tasks collapsed", async () => {
    render(<GoogleTasksBoard repoPath="/repo" onKickoff={onKickoff} />);
    const inbox = await screen.findByRole("region", { name: "Inbox" });
    expect(screen.getByRole("region", { name: "Doing" })).toBeInTheDocument();
    expect(await within(inbox).findByText("Write spec")).toBeInTheDocument();
    expect(within(inbox).queryByText("Old task")).not.toBeInTheDocument();
    await userEvent.click(within(inbox).getByText("Completed (1)"));
    expect(within(inbox).getByText("Old task")).toBeInTheDocument();
  });

  it("adds a task to a column", async () => {
    render(<GoogleTasksBoard repoPath="/repo" onKickoff={onKickoff} />);
    const doing = await screen.findByRole("region", { name: "Doing" });
    await userEvent.click(within(doing).getByText("Add a task"));
    await userEvent.type(
      within(doing).getByLabelText("New task in Doing"),
      "Ship it{Enter}",
    );
    expect(api.googleCreateTask).toHaveBeenCalledWith("doing", {
      title: "Ship it",
    });
  });

  it("completes a task", async () => {
    render(<GoogleTasksBoard repoPath="/repo" onKickoff={onKickoff} />);
    await userEvent.click(await screen.findByLabelText("Complete Write spec"));
    expect(api.googleUpdateTask).toHaveBeenCalledWith("inbox", "t1", {
      status: "completed",
    });
  });

  it("moves a task when dropped on another column", async () => {
    render(<GoogleTasksBoard repoPath="/repo" onKickoff={onKickoff} />);
    const card = await screen.findByTestId("google-task-t1");
    const doing = screen.getByRole("region", { name: "Doing" });
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (k: string, v: string) => data.set(k, v),
      getData: (k: string) => data.get(k) ?? "",
      get types() {
        return [...data.keys()];
      },
    };
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(doing, { dataTransfer });
    fireEvent.drop(doing, { dataTransfer });
    await vi.waitFor(() =>
      expect(api.googleMoveTask).toHaveBeenCalledWith({
        listId: "inbox",
        taskId: "t1",
        destinationListId: "doing",
        previousTaskId: undefined,
      }),
    );
  });

  it("leaves a top-level task alone when dropped on its own column", async () => {
    render(<GoogleTasksBoard repoPath="/repo" onKickoff={onKickoff} />);
    const card = await screen.findByTestId("google-task-t1");
    const inbox = screen.getByRole("region", { name: "Inbox" });
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (k: string, v: string) => data.set(k, v),
      getData: (k: string) => data.get(k) ?? "",
      get types() {
        return [...data.keys()];
      },
    };
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(inbox, { dataTransfer });
    fireEvent.drop(inbox, { dataTransfer });
    await new Promise((r) => setTimeout(r, 0));
    expect(api.googleMoveTask).not.toHaveBeenCalled();
  });

  it("clears a due date", async () => {
    api.googleListTasks.mockImplementation(async (listId: string) =>
      listId === "inbox" ? [task({ due: "2026-10-03T00:00:00.000Z" })] : [],
    );
    render(<GoogleTasksBoard repoPath="/repo" onKickoff={onKickoff} />);
    await userEvent.click(
      await screen.findByLabelText("Actions for Write spec"),
    );
    await userEvent.click(await screen.findByText("Clear due date"));
    expect(api.googleUpdateTask).toHaveBeenCalledWith("inbox", "t1", {
      due: "",
    });
  });

  it("keeps the due date input open after choosing Set due date", async () => {
    render(<GoogleTasksBoard repoPath="/repo" onKickoff={onKickoff} />);
    await userEvent.click(
      await screen.findByLabelText("Actions for Write spec"),
    );
    await userEvent.click(await screen.findByText("Set due date"));
    const input = await screen.findByLabelText("Due date for Write spec");
    await new Promise((r) => setTimeout(r, 50));
    expect(input).toBeInTheDocument();
    expect(input).toHaveFocus();
  });

  it("kicks off an agent from a task with its open subtasks", async () => {
    render(<GoogleTasksBoard repoPath="/repo" onKickoff={onKickoff} />);
    await userEvent.click(
      await screen.findByLabelText("Actions for Write spec"),
    );
    await userEvent.click(await screen.findByText("Kick off agent"));
    expect(onKickoff).toHaveBeenCalledWith(
      "Write spec\n\nSteps:\n- Draft outline",
    );
  });

  it("edits a task's title and notes", async () => {
    render(<GoogleTasksBoard repoPath="/repo" onKickoff={onKickoff} />);
    await userEvent.click(
      await screen.findByLabelText("Actions for Write spec"),
    );
    await userEvent.click(await screen.findByText("Edit"));
    const title = await screen.findByLabelText("Task title");
    await userEvent.clear(title);
    await userEvent.type(title, "Write the spec");
    await userEvent.type(screen.getByLabelText("Task notes"), "v2");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(api.googleUpdateTask).toHaveBeenCalledWith("inbox", "t1", {
      title: "Write the spec",
      notes: "v2",
    });
  });

  it("adds a subtask under a task", async () => {
    render(<GoogleTasksBoard repoPath="/repo" onKickoff={onKickoff} />);
    await userEvent.click(
      await screen.findByLabelText("Actions for Write spec"),
    );
    await userEvent.click(await screen.findByText("Add subtask"));
    await userEvent.type(
      await screen.findByLabelText("Task title"),
      "Review{Enter}",
    );
    expect(api.googleCreateTask).toHaveBeenCalledWith("inbox", {
      title: "Review",
      notes: undefined,
      parent: "t1",
    });
  });
});
