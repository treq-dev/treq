import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "../../../test/test-utils";
import type { GoogleTask } from "../../lib/api-google";
import { CreateLinearIssueDialog } from "./CreateLinearIssueDialog";

const api = vi.hoisted(() => ({
  googleListTasks: vi.fn(),
  googleUpdateTask: vi.fn(),
  linearListTeams: vi.fn(),
  linearCreateIssue: vi.fn(),
}));

vi.mock("../../lib/api-google", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api-google")>()),
  googleListTasks: api.googleListTasks,
  googleUpdateTask: api.googleUpdateTask,
}));
vi.mock("../../lib/api-linear", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api-linear")>()),
  linearListTeams: api.linearListTeams,
  linearCreateIssue: api.linearCreateIssue,
}));

const task: GoogleTask = {
  id: "t1",
  list_id: "inbox",
  title: "Write spec",
  notes: "old notes",
  status: "needsAction",
  due: null,
  parent: null,
  position: "1",
  web_link: null,
};

describe("CreateLinearIssueDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.linearListTeams.mockResolvedValue([
      { id: "team1", key: "ENG", name: "Engineering" },
    ]);
    api.linearCreateIssue.mockResolvedValue({
      identifier: "ENG-1",
      url: "https://linear.app/i/ENG-1",
    });
    api.googleUpdateTask.mockResolvedValue(task);
  });

  it("links the issue onto the task's current notes, not the stale copy", async () => {
    api.googleListTasks.mockResolvedValue([
      { ...task, notes: "edited elsewhere" },
    ]);
    render(
      <CreateLinearIssueDialog
        repoPath="/repo"
        task={task}
        onClose={vi.fn()}
        onLinked={vi.fn()}
      />,
    );
    await userEvent.click(await screen.findByText("Engineering"));
    await vi.waitFor(() =>
      expect(api.googleUpdateTask).toHaveBeenCalledWith("inbox", "t1", {
        notes: "edited elsewhere\n\nLinear: ENG-1 https://linear.app/i/ENG-1",
      }),
    );
  });
});
