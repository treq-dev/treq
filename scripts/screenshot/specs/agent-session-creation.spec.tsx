import { expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { createTestRepo, openRepo } from "../../../test/utils";
import { installFakeAgents } from "../../../test/fake-agent";
import { render, screen, waitFor, within } from "../../../test/test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import { createWorkspace, getSessions } from "../../../src/lib/api";
import { captureDocument } from "../capture";

const TARGET_BRANCH = "feat/session-target";
const PROMPT = "Add input validation to the signup form";

// Walks the full "Start a new agent session" flow from the home repo: open
// the dialog with Cmd+I, pick a non-default workspace, type a prompt, and
// submit with "Edit". A fake `claude` binary on PATH stands in for the real
// agent so the spawned terminal has something to run.
it("captures agent session creation from the prompt dialog", async () => {
  const restoreAgents = installFakeAgents();

  try {
    const { repoPath, defaultBranch } = createTestRepo(false);
    openRepo(repoPath);
    // Background state: a workspace for the picker to list.
    const targetWorkspaceId = await createWorkspace(repoPath, TARGET_BRANCH);

    const user = userEvent.setup();
    render(<Dashboard />);
    await screen.findByTestId("show-workspace-header");

    await user.keyboard("{Meta>}i{/Meta}");
    const dialog = (
      await screen.findByRole("heading", { name: "Start a new agent session" })
    ).closest('[data-testid="modal"]') as HTMLElement;
    expect(dialog).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: /^edit$/i }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: "More submit options" }),
    ).toBeDisabled();

    await captureDocument(document, {
      name: "agent-session-creation-01-dialog-empty",
      expectations: [
        "A centered modal titled 'Start a new agent session' shows a branch picker set to the home repo's default branch.",
        "The task input shows the 'Describe a task...' placeholder, with an Edit button joined to a chevron (the Plan menu) that both look disabled (dimmed).",
      ],
    });

    // The agent <select> is also a combobox; the branch picker is the button.
    const branchPicker = () =>
      dialog.querySelector('button[role="combobox"]') as HTMLElement;
    await user.click(branchPicker());
    await user.click(
      await screen.findByRole("option", { name: TARGET_BRANCH }),
    );
    await waitFor(() =>
      expect(branchPicker()).toHaveTextContent(TARGET_BRANCH),
    );
    await user.type(
      within(dialog).getByPlaceholderText("Describe a task..."),
      PROMPT,
    );
    expect(
      within(dialog).getByRole("button", { name: /^edit$/i }),
    ).toBeEnabled();

    await captureDocument(document, {
      name: "agent-session-creation-02-dialog-filled",
      expectations: [
        `The branch picker now reads '${TARGET_BRANCH}'.`,
        `The task input contains "${PROMPT}" and the Edit button and its chevron are no longer dimmed.`,
      ],
    });

    await user.click(within(dialog).getByRole("button", { name: /^edit$/i }));
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Start a new agent session" }),
      ).not.toBeInTheDocument(),
    );

    // The session row is persisted against the chosen workspace.
    await waitFor(async () => {
      const sessions = await getSessions(repoPath);
      expect(
        sessions.some(
          (s) => s.workspace_id === targetWorkspaceId && s.name === PROMPT,
        ),
      ).toBe(true);
    });
    await waitFor(() =>
      expect(
        document.querySelector('[data-terminal-id^="claude-"]'),
      ).not.toBeNull(),
    );

    // Starting a session in another workspace does not navigate: the page
    // stays on the workspace the user was viewing, and the terminal tab's
    // branch badge is what names the session's workspace.
    const header = screen.getByTestId("show-workspace-header");
    expect(header).toHaveTextContent(defaultBranch);
    expect(header).not.toHaveTextContent(TARGET_BRANCH);
    expect(
      screen.getByText(TARGET_BRANCH, {
        selector: '[data-testid="workspace-terminal-pane"] *',
      }),
    ).toBeInTheDocument();

    const pane = screen.getByTestId("workspace-terminal-pane");
    await within(pane).findByText(
      `prompt: ${PROMPT}`,
      {},
      { timeout: 15000 },
    );

    await captureDocument(document, {
      name: "agent-session-creation-03-session-started",
      expectations: [
        `The prompt dialog is closed and the agent terminal shows the fake agent's output, ending with 'prompt: ${PROMPT}'.`,
        `The terminal tab carries a '${TARGET_BRANCH}' badge naming the session's workspace.`,
        `The page stays on the home repo: the header and highlighted sidebar row show the default branch, not ${TARGET_BRANCH}.`,
      ],
    });
  } finally {
    restoreAgents();
  }
}, 120000);
