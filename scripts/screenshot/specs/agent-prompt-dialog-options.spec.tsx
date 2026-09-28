import { expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { createTestRepo, openRepo } from "../../../test/utils";
import { installFakeAgents } from "../../../test/fake-agent";
import { render, screen, waitFor, within } from "../../../test/test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import {
  getRepoSetting,
  getSessions,
} from "../../../src/lib/api";
import { captureDocument } from "../capture";

async function openPromptDialog(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByTestId("show-workspace-header");
  await user.keyboard("{Meta>}i{/Meta}");
  return (
    await screen.findByRole("heading", { name: "Start a new agent session" })
  ).closest('[data-testid="modal"]') as HTMLElement;
}

it("switches the agent to Codex and saves it as the repo default on submit", async () => {
  const restoreAgents = installFakeAgents();
  try {
    const { repoPath } = createTestRepo(false);
    openRepo(repoPath);

    const user = userEvent.setup();
    render(<Dashboard />);
    const dialog = await openPromptDialog(user);

    await user.selectOptions(within(dialog).getByLabelText("Agent"), "codex");
    expect(
      within(dialog).queryByRole("button", { name: /^plan$/i }),
    ).not.toBeInTheDocument();
    const runButton = within(dialog).getByRole("button", { name: /^run$/i });
    const saveDefault = within(dialog).getByRole("checkbox", {
      name: "Set as default for this repo",
    });
    await user.click(saveDefault);
    await user.type(
      within(dialog).getByPlaceholderText("Describe a task..."),
      "Add a changelog entry",
    );
    expect(saveDefault).toBeChecked();

    await captureDocument(document, {
      name: "agent-prompt-dialog-options-01-codex",
      expectations: [
        "The agent dropdown in the prompt toolbar reads 'Codex'.",
        "There is no Plan button; the primary button reads 'Run' instead of 'Edit'.",
        "A checked 'Set as default for this repo' checkbox sits to the left of the agent dropdown.",
      ],
    });

    await user.click(runButton);
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Start a new agent session" }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(async () =>
      expect(await getRepoSetting(repoPath, "default_agent")).toBe("codex"),
    );
    await waitFor(async () =>
      expect(
        (await getSessions(repoPath)).some(
          (s) => s.name === "Add a changelog entry",
        ),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(
        document.querySelector('[data-terminal-id^="claude-"]'),
      ).not.toBeNull(),
    );

    await captureDocument(document, {
      name: "agent-prompt-dialog-options-02-codex-started",
      expectations: [
        "The prompt dialog is closed and an agent terminal pane is open with a tab titled 'Add a changelog entry'.",
        "The terminal tab shows the Codex icon, not the Claude sparkle.",
      ],
    });
  } finally {
    restoreAgents();
  }
}, 120000);

it("inserts an @-mentioned file and submits with Cmd+Enter", async () => {
  const restoreAgents = installFakeAgents();
  try {
    const { repoPath } = createTestRepo(false);
    openRepo(repoPath);

    const user = userEvent.setup();
    render(<Dashboard />);
    const dialog = await openPromptDialog(user);
    const textarea = within(dialog).getByPlaceholderText("Describe a task...");

    // Fresh repo: nothing else has indexed the workspace yet, so typing @
    // must build the index itself before suggestions appear.
    await user.type(textarea, "Update @READ");
    const suggestion = await within(dialog).findByRole(
      "button",
      { name: "README.md" },
      { timeout: 10000 },
    );
    expect(suggestion).toBeInTheDocument();

    await captureDocument(document, {
      name: "agent-prompt-dialog-options-03-mention-dropdown",
      expectations: [
        "Below the typed text 'Update @READ', a 'FILES' dropdown inside the prompt input lists README.md.",
        "The README.md row is highlighted as the current selection.",
      ],
    });

    await user.keyboard("{Enter}");
    await waitFor(() => expect(textarea).toHaveValue("Update @README.md "));
    await user.type(textarea, "with install steps");

    await captureDocument(document, {
      name: "agent-prompt-dialog-options-04-mention-inserted",
      expectations: [
        "The prompt reads 'Update @README.md with install steps' and the Files dropdown is closed.",
      ],
    });

    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Start a new agent session" }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(async () =>
      expect(
        (await getSessions(repoPath)).some(
          (s) => s.name === "Update @README.md with install steps",
        ),
      ).toBe(true),
    );
  } finally {
    restoreAgents();
  }
}, 120000);
