import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Dashboard } from "../../src/components/Dashboard";
import { installFakeAgents } from "../fake-agent";
import { render, screen, within } from "../test-utils";
import { createTestRepo, openRepo } from "../utils";

async function openPromptDialog(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByTestId("show-workspace-header");
  await user.keyboard("{Meta>}i{/Meta}");
  return (
    await screen.findByRole("heading", { name: "Start a new agent session" })
  ).closest('[data-testid="modal"]') as HTMLElement;
}

describe("plan split button", () => {
  let user: ReturnType<typeof userEvent.setup>;
  let restoreAgents: () => void;

  beforeEach(() => {
    restoreAgents = installFakeAgents();
    const { repoPath } = createTestRepo(false);
    openRepo(repoPath);
    user = userEvent.setup();
  });

  afterEach(() => {
    restoreAgents();
  });

  it("keeps Edit as the main action and moves Plan into the menu", async () => {
    render(<Dashboard />);
    const dialog = await openPromptDialog(user);

    expect(
      within(dialog).queryByRole("button", { name: /^plan$/i }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /^edit$/i }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: "More submit options" }),
    ).toBeDisabled();
  });

  it("starts the session in plan mode from the menu", async () => {
    render(<Dashboard />);
    const dialog = await openPromptDialog(user);
    await user.type(
      within(dialog).getByPlaceholderText("Describe a task..."),
      "Sketch the migration",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "More submit options" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: /^plan/i }));

    const pane = await screen.findByTestId("workspace-terminal-pane");
    expect(
      await within(pane).findByText("mode: plan", {}, { timeout: 15000 }),
    ).toBeInTheDocument();
    expect(
      within(pane).getByText("prompt: Sketch the migration"),
    ).toBeInTheDocument();
  }, 30000);

  it("hides the menu for agents without plan mode", async () => {
    render(<Dashboard />);
    const dialog = await openPromptDialog(user);
    await user.selectOptions(within(dialog).getByLabelText("Agent"), "codex");

    expect(
      within(dialog).getByRole("button", { name: /^run$/i }),
    ).toBeVisible();
    expect(
      within(dialog).queryByRole("button", { name: "More submit options" }),
    ).not.toBeInTheDocument();
  });
});
