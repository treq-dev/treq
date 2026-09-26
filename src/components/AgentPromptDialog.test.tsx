import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "../../test/test-utils";
import type { Workspace } from "../lib/api";
import { AgentPromptDialog } from "./AgentPromptDialog";

vi.mock("./TaskInput", () => ({
  TaskInput: ({
    onSessionCreated,
    initialText,
    initialGitHubIssue,
    onLinearIssueChange,
  }: {
    onSessionCreated: (value: unknown) => void;
    initialText?: string;
    initialGitHubIssue?: { number: number; url: string; title: string } | null;
    onLinearIssueChange?: (issue: null) => void;
  }) => (
    <div>
      <button onClick={() => onLinearIssueChange?.(null)}>
        Remove attached Linear issue
      </button>
      <div data-testid="task-input-initial-text">{initialText ?? ""}</div>
      <div data-testid="task-input-initial-github-issue">
        {initialGitHubIssue ? `#${initialGitHubIssue.number}` : ""}
      </div>
      <button onClick={() => onSessionCreated({ sessionId: 12 })}>
        Shared prompt input
      </button>
    </div>
  ),
}));

const workspace: Workspace = {
  id: 2,
  repo_path: "/repo",
  workspace_name: "feat-one",
  workspace_path: "/repo/.treq/feat-one",
  branch_name: "feat/one",
  created_at: "now",
  title: "Feature one",
  not_on_remote: false,
};

describe("AgentPromptDialog", () => {
  it("defaults to the repo branch, selects searchable workspaces, and closes after starting", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onSessionCreated = vi.fn();
    render(
      <AgentPromptDialog
        open
        onOpenChange={onOpenChange}
        repoPath="/repo"
        defaultBranch="main"
        workspaces={[workspace]}
        onSessionCreated={onSessionCreated}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Start a new agent session" }),
    ).toBeTruthy();
    expect(screen.getByRole("combobox")).toHaveTextContent("main");
    await user.click(screen.getByRole("combobox"));
    await user.type(
      screen.getByPlaceholderText("Search workspaces..."),
      "feat/one",
    );
    await user.click(screen.getByText("feat/one"));
    expect(screen.getByRole("combobox")).toHaveTextContent("feat/one");

    await user.click(screen.getByText("Shared prompt input"));
    expect(onSessionCreated).toHaveBeenCalledWith({ sessionId: 12 });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("excludes the default-branch workspace from the picker list", async () => {
    const user = userEvent.setup();
    const defaultBranchWorkspace: Workspace = {
      ...workspace,
      id: 3,
      branch_name: "main",
      workspace_name: "main",
      workspace_path: "/repo/.treq/main",
    };

    render(
      <AgentPromptDialog
        open
        onOpenChange={vi.fn()}
        repoPath="/repo"
        defaultBranch="main"
        workspaces={[workspace, defaultBranchWorkspace]}
        onSessionCreated={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("combobox"));
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options.map((option) => option.textContent)).toEqual([
      "main",
      "feat/one",
    ]);
  });

  it("pre-fills the prompt and selects its originating workspace when initialPrompt/initialWorkspaceId are set", () => {
    render(
      <AgentPromptDialog
        open
        onOpenChange={vi.fn()}
        repoPath="/repo"
        defaultBranch="main"
        workspaces={[workspace]}
        onSessionCreated={vi.fn()}
        initialPrompt="Build the login page"
        initialWorkspaceId={workspace.id}
      />,
    );

    expect(screen.getByRole("combobox")).toHaveTextContent("feat/one");
    expect(screen.getByTestId("task-input-initial-text")).toHaveTextContent(
      "Build the login page",
    );
  });

  it("falls back to the default branch when initialWorkspaceId has no match", () => {
    render(
      <AgentPromptDialog
        open
        onOpenChange={vi.fn()}
        repoPath="/repo"
        defaultBranch="main"
        workspaces={[workspace]}
        onSessionCreated={vi.fn()}
        initialPrompt="Some prompt"
        initialWorkspaceId={999}
      />,
    );

    expect(screen.getByRole("combobox")).toHaveTextContent("main");
    expect(screen.getByTestId("task-input-initial-text")).toHaveTextContent(
      "Some prompt",
    );
  });

  it("passes an initial GitHub issue chip into TaskInput", () => {
    render(
      <AgentPromptDialog
        open
        onOpenChange={vi.fn()}
        repoPath="/repo"
        defaultBranch="main"
        workspaces={[workspace]}
        onSessionCreated={vi.fn()}
        initialGitHubIssue={{
          number: 42,
          url: "https://github.com/acme/treq/issues/42",
          title: "Fix the login bug",
        }}
      />,
    );

    expect(
      screen.getByTestId("task-input-initial-github-issue"),
    ).toHaveTextContent("#42");
  });

  it("replaces the workspace picker with the issue's new workspace while a Linear issue is attached", async () => {
    const user = userEvent.setup();
    render(
      <AgentPromptDialog
        open
        onOpenChange={vi.fn()}
        repoPath="/repo"
        defaultBranch="main"
        workspaces={[workspace]}
        onSessionCreated={vi.fn()}
        initialLinearIssue={{
          id: "issue-1",
          identifier: "ENG-101",
          url: "https://linear.app/treq/issue/ENG-101",
          title: "Rework the ranking pipeline",
          includeSubissues: false,
        }}
      />,
    );

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText(/Opens a workspace for ENG-101/)).toBeTruthy();

    await user.click(screen.getByText("Remove attached Linear issue"));
    expect(screen.getByRole("combobox")).toHaveTextContent("main");
  });
});
