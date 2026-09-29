/**
 * The prompt toolbar's submit button group: Edit is always the main action
 * and plan mode lives in its dropdown. The fake agent reports the mode it
 * was launched with, so the terminal shows the plan session took effect.
 */
import userEvent from "@testing-library/user-event";
import { expect, it, onTestFinished } from "vitest";
import { Dashboard } from "../../../src/components/Dashboard";
import { installFakeAgents } from "../../../test/fake-agent";
import { render, screen, within } from "../../../test/test-utils";
import { createTestRepo, openRepo } from "../../../test/utils";
import { captureDocument } from "../capture";

it("captures the plan menu and the plan session it starts", async () => {
  onTestFinished(installFakeAgents());
  const { repoPath } = createTestRepo(false);
  openRepo(repoPath);
  const user = userEvent.setup();
  render(<Dashboard />);
  await screen.findByTestId("show-workspace-header");
  await user.keyboard("{Meta>}i{/Meta}");
  const dialog = (
    await screen.findByRole("heading", { name: "Start a new agent session" })
  ).closest('[data-testid="modal"]') as HTMLElement;
  await user.type(
    within(dialog).getByPlaceholderText("Describe a task..."),
    "Sketch the migration",
  );
  await user.click(
    within(dialog).getByRole("button", { name: "More submit options" }),
  );
  const planItem = await screen.findByRole("menuitem", { name: /^plan/i });

  await captureDocument(document, {
    name: "plan-split-button-01-menu",
    expectations: [
      "In the prompt dialog's toolbar, the blue 'Edit' button is joined to a narrow chevron button on its right, forming one button group.",
      "The plan menu is open above the dialog and its overlay (jsdom has no layout, so it renders at the top-left), showing a 'Plan' item with the hint 'Plan the change first, without editing files'.",
      "There is no separate standalone 'Plan' button next to 'Edit'.",
    ],
  });

  await user.click(planItem);
  const pane = await screen.findByTestId("workspace-terminal-pane");
  expect(
    await within(pane).findByText("mode: plan", {}, { timeout: 15000 }),
  ).toBeInTheDocument();

  await captureDocument(document, {
    name: "plan-split-button-02-plan-session",
    expectations: [
      "The prompt dialog is closed.",
      "The agent terminal shows the fake agent's output with 'mode: plan' and 'prompt: Sketch the migration'.",
    ],
  });
}, 120000);
