import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "../../test/test-utils";
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
});
