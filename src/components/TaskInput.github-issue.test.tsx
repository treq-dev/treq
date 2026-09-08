import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "../../test/test-utils";
import { TaskInput } from "./TaskInput";

const api = vi.hoisted(() => ({
  createSession: vi.fn(),
  getSetting: vi.fn(),
  getRepoSetting: vi.fn(),
  setRepoSetting: vi.fn(),
  searchWorkspaceFiles: vi.fn(),
  getWorkspaces: vi.fn(),
}));

const linearApi = vi.hoisted(() => ({
  linearOpenOrCreateWorkspaceFromIssue: vi.fn(),
}));

vi.mock("../lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/api")>();
  return {
    ...original,
    createSession: api.createSession,
    getSetting: api.getSetting,
    getRepoSetting: api.getRepoSetting,
    setRepoSetting: api.setRepoSetting,
    searchWorkspaceFiles: api.searchWorkspaceFiles,
    getWorkspaces: api.getWorkspaces,
  };
});

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("../lib/api-linear", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api-linear")>()),
  ...linearApi,
}));

describe("TaskInput GitHub issue chip", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
    api.createSession.mockReset();
    api.createSession.mockResolvedValue(99);
    api.getSetting.mockResolvedValue("claude");
    api.getRepoSetting.mockResolvedValue(null);
    api.setRepoSetting.mockResolvedValue(undefined);
    api.searchWorkspaceFiles.mockResolvedValue([]);
    api.getWorkspaces.mockResolvedValue([]);
    linearApi.linearOpenOrCreateWorkspaceFromIssue.mockReset();
  });

  it("renders a dismissible GitHub issue chip from initialGitHubIssue", async () => {
    render(
      <TaskInput
        repoPath="/repo"
        workspaceId={null}
        workingDirectory="/repo"
        initialGitHubIssue={{
          number: 42,
          url: "https://github.com/acme/treq/issues/42",
          title: "Fix the login bug",
        }}
      />,
    );

    const chip = await screen.findByTestId("github-issue-chip");
    expect(chip).toHaveTextContent("#42");

    await user.click(
      screen.getByRole("button", { name: /remove github issue/i }),
    );
    expect(screen.queryByTestId("github-issue-chip")).not.toBeInTheDocument();
  });

  it("includes the issue number in the pending prompt on submit", async () => {
    const onSessionCreated = vi.fn();
    render(
      <TaskInput
        repoPath="/repo"
        workspaceId={1}
        workingDirectory="/repo/.treq/feat"
        onSessionCreated={onSessionCreated}
        initialGitHubIssue={{
          number: 42,
          url: "https://github.com/acme/treq/issues/42",
          title: "Fix the login bug",
        }}
      />,
    );

    await screen.findByTestId("github-issue-chip");
    await user.type(
      screen.getByPlaceholderText("Describe a task..."),
      "fix auth",
    );
    await user.click(screen.getByRole("button", { name: /^edit$/i }));

    await waitFor(() => {
      expect(onSessionCreated).toHaveBeenCalled();
    });
    expect(onSessionCreated.mock.calls[0][0].pendingPrompt).toContain(
      "GitHub issue #42:",
    );
    expect(onSessionCreated.mock.calls[0][0].pendingPrompt).toContain(
      "fix auth",
    );
  });

  it("identifies the workspace without sending a working directory", async () => {
    const onSessionCreated = vi.fn();
    render(
      <TaskInput
        repoPath="/repo"
        workspaceId={1}
        workingDirectory="/repo/.treq/workspaces/feature-one"
        onSessionCreated={onSessionCreated}
      />,
    );

    await user.type(
      screen.getByPlaceholderText("Describe a task..."),
      "fix the workspace bug",
    );
    await user.click(screen.getByRole("button", { name: /^edit$/i }));

    await waitFor(() => expect(onSessionCreated).toHaveBeenCalled());
    expect(onSessionCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 1,
        workspacePath: null,
      }),
    );
  });

  it("creates the Linear issue workspace before creating its agent session", async () => {
    const onSessionCreated = vi.fn();
    linearApi.linearOpenOrCreateWorkspaceFromIssue.mockResolvedValue([
      { issue_id: "issue-id", workspace_id: 7, created: true },
    ]);
    api.getWorkspaces.mockResolvedValue([
      {
        id: 7,
        repo_path: "/repo",
        workspace_name: "treq-281",
        workspace_path: ".treq/workspaces/treq-281",
        branch_name: "ty/treq-281-linear-integration",
        created_at: "now",
        title: "Linear integration should CRUD issues",
        not_on_remote: true,
      },
    ]);
    render(
      <TaskInput
        repoPath="/repo"
        workspaceId={null}
        workingDirectory="/repo"
        onSessionCreated={onSessionCreated}
        initialLinearIssue={{
          id: "issue-id",
          identifier: "TREQ-281",
          title: "Linear integration should CRUD issues",
          url: "https://linear.app/treq/issue/TREQ-281",
          includeSubissues: false,
        }}
      />,
    );

    expect(await screen.findByTestId("linear-issue-chip")).toHaveTextContent(
      "TREQ-281",
    );
    await user.click(screen.getByRole("button", { name: /^edit$/i }));

    await waitFor(() => expect(api.createSession).toHaveBeenCalled());
    expect(linearApi.linearOpenOrCreateWorkspaceFromIssue).toHaveBeenCalledWith(
      "/repo",
      "issue-id",
      false,
    );
    expect(api.createSession).toHaveBeenCalledWith(
      "/repo",
      7,
      expect.stringContaining("TREQ-281"),
    );
    expect(onSessionCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 7,
        workspacePath: null,
        pendingPrompt: expect.stringContaining("Linear issue TREQ-281"),
      }),
    );
  });
});
