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
          ]
        : [],
    );
    api.googleCreateTask.mockResolvedValue(task({ id: "new" }));
    api.googleUpdateTask.mockResolvedValue(task({}));
    api.googleMoveTask.mockResolvedValue(task({ list_id: "doing" }));
  });

  it("shows one column per task list with completed tasks collapsed", async () => {
    render(<GoogleTasksBoard repoPath="/repo" />);
    const inbox = await screen.findByRole("region", { name: "Inbox" });
    expect(screen.getByRole("region", { name: "Doing" })).toBeInTheDocument();
    expect(await within(inbox).findByText("Write spec")).toBeInTheDocument();
    expect(within(inbox).queryByText("Old task")).not.toBeInTheDocument();
    await userEvent.click(within(inbox).getByText("Completed (1)"));
    expect(within(inbox).getByText("Old task")).toBeInTheDocument();
  });

  it("adds a task to a column", async () => {
    render(<GoogleTasksBoard repoPath="/repo" />);
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
    render(<GoogleTasksBoard repoPath="/repo" />);
    await userEvent.click(await screen.findByLabelText("Complete Write spec"));
    expect(api.googleUpdateTask).toHaveBeenCalledWith("inbox", "t1", {
      status: "completed",
    });
  });

  it("moves a task when dropped on another column", async () => {
    render(<GoogleTasksBoard repoPath="/repo" />);
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
});
