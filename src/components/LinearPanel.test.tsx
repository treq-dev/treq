import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "../../test/test-utils";
import type { LinearIssue } from "../lib/api-linear";
import { LinearPanel } from "./LinearPanel";

const api = vi.hoisted(() => ({
  linearListIssues: vi.fn(),
  linearListTeams: vi.fn(),
  linearGetViewer: vi.fn(),
  linearOpenOrCreateWorkspaceFromIssue: vi.fn(),
}));

vi.mock("../lib/api-linear", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api-linear")>()),
  ...api,
}));

const issue: LinearIssue = {
  id: "issue-id",
  identifier: "TREQ-281",
  title: "Linear integration should CRUD issues",
  description: "Implement the issue workflow",
  state: { name: "Todo", type: "unstarted" },
  labels: [],
  branch_name: "ty/treq-281-linear-integration",
  parent_id: null,
  sub_issue_ids: [],
  url: "https://linear.app/treq/issue/TREQ-281",
};

describe("LinearPanel issue kickoff", () => {
  beforeEach(() => {
    api.linearListTeams.mockResolvedValue([]);
    api.linearListIssues.mockResolvedValue([issue]);
    api.linearGetViewer.mockResolvedValue({ id: "viewer-id", name: "Viewer" });
    api.linearOpenOrCreateWorkspaceFromIssue.mockReset();
  });

  it("opens the agent prompt with the Linear issue instead of creating immediately", async () => {
    const user = userEvent.setup();
    const onStartPromptFromIssue = vi.fn();
    render(
      <LinearPanel
        repoPath="/repo"
        onStartPromptFromIssue={onStartPromptFromIssue}
      />,
    );

    await user.click(await screen.findByRole("tab", { name: "Kanban" }));
    await user.click(await screen.findByRole("button", { name: "Kick off" }));

    expect(onStartPromptFromIssue).toHaveBeenCalledWith({
      ...issue,
      includeSubissues: false,
    });
    expect(api.linearOpenOrCreateWorkspaceFromIssue).not.toHaveBeenCalled();
  });

  it("kicks off from a list row, including sub-issues when it has any", async () => {
    const user = userEvent.setup();
    const onStartPromptFromIssue = vi.fn();
    const parent = { ...issue, sub_issue_ids: ["child-id"] };
    const child: LinearIssue = {
      ...issue,
      id: "child-id",
      identifier: "TREQ-282",
      title: "Child issue",
      parent_id: parent.id,
    };
    api.linearListIssues.mockResolvedValue([parent, child]);
    render(
      <LinearPanel
        repoPath="/repo"
        onStartPromptFromIssue={onStartPromptFromIssue}
      />,
    );

    await screen.findByText("Child issue");
    const [parentKickoff] = screen.getAllByRole("button", {
      name: "Kick off",
    });
    await user.click(parentKickoff!);

    expect(onStartPromptFromIssue).toHaveBeenCalledWith({
      ...parent,
      includeSubissues: true,
    });
    expect(screen.queryByTestId("linear-issue-expanded")).toBeNull();
  });

  it("shows a sub-issue whose parent is filtered out of the view", async () => {
    const user = userEvent.setup();
    const parent: LinearIssue = {
      ...issue,
      title: "Someone else's parent",
      sub_issue_ids: ["child-id"],
      assignee: { id: "other-id", name: "Other" },
    };
    const child: LinearIssue = {
      ...issue,
      id: "child-id",
      identifier: "TREQ-282",
      title: "My sub-issue",
      parent_id: parent.id,
      assignee: { id: "viewer-id", name: "Viewer" },
    };
    api.linearListIssues.mockResolvedValue([parent, child]);
    render(<LinearPanel repoPath="/repo" />);

    await screen.findByText("Someone else's parent");
    await user.click(screen.getByRole("tab", { name: "My Issues" }));

    expect(await screen.findByText("My sub-issue")).toBeInTheDocument();
    expect(screen.queryByText("Someone else's parent")).toBeNull();

    await user.click(screen.getByRole("tab", { name: "Kanban" }));
    expect(await screen.findByText("My sub-issue")).toBeInTheDocument();
  });

  it("shows a sub-issue whose parent was not loaded", async () => {
    const orphan: LinearIssue = {
      ...issue,
      id: "child-id",
      identifier: "TREQ-282",
      title: "Orphan sub-issue",
      parent_id: "missing-parent-id",
    };
    api.linearListIssues.mockResolvedValue([orphan]);
    render(<LinearPanel repoPath="/repo" />);

    expect(await screen.findByText("Orphan sub-issue")).toBeInTheDocument();
  });

  it("places each kanban card in its own state column, in workflow order", async () => {
    const user = userEvent.setup();
    const parent: LinearIssue = {
      ...issue,
      title: "Parent issue",
      sub_issue_ids: ["child-id"],
    };
    const child: LinearIssue = {
      ...issue,
      id: "child-id",
      identifier: "TREQ-282",
      title: "Child in progress",
      state: { name: "In Progress", type: "started" },
      parent_id: parent.id,
    };
    const done: LinearIssue = {
      ...issue,
      id: "done-id",
      identifier: "TREQ-283",
      title: "Finished work",
      state: { name: "Done", type: "completed" },
    };
    const backlog: LinearIssue = {
      ...issue,
      id: "backlog-id",
      identifier: "TREQ-284",
      title: "Someday work",
      state: { name: "Backlog", type: "backlog" },
    };
    const triage: LinearIssue = {
      ...issue,
      id: "triage-id",
      identifier: "TREQ-285",
      title: "New report",
      state: { name: "Triage", type: "triage" },
    };
    const canceled: LinearIssue = {
      ...issue,
      id: "canceled-id",
      identifier: "TREQ-286",
      title: "Dropped work",
      state: { name: "Canceled", type: "canceled" },
    };
    api.linearListIssues.mockResolvedValue([
      done,
      canceled,
      child,
      parent,
      backlog,
      triage,
    ]);
    render(<LinearPanel repoPath="/repo" />);

    await user.click(await screen.findByRole("tab", { name: "Kanban" }));
    await screen.findByText("Child in progress");

    const columnNames = screen
      .getAllByRole("region")
      .map((column) => column.getAttribute("aria-label"));
    expect(columnNames).toEqual([
      "Triage",
      "Backlog",
      "Todo",
      "In Progress",
      "Done",
      "Canceled",
    ]);

    const todo = screen.getByRole("region", { name: "Todo" });
    expect(within(todo).getByText("Parent issue")).toBeInTheDocument();
    expect(within(todo).queryByText("Child in progress")).toBeNull();

    const inProgress = screen.getByRole("region", { name: "In Progress" });
    expect(
      within(inProgress).getByText("Child in progress"),
    ).toBeInTheDocument();
    expect(
      within(inProgress).getByText("Sub-issue of TREQ-281"),
    ).toBeInTheDocument();
  });
});
