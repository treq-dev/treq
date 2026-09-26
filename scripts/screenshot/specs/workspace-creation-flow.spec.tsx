import * as fs from "node:fs";
import * as path from "node:path";
import * as React from "react";
import { expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { createTestRepo, openRepo } from "../../../test/utils";
import { render, screen, waitFor, within } from "../../../test/test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import { createWorkspace } from "../../../src/lib/api";
import { captureDocument } from "../capture";

const EXISTING_BRANCH = "treq/existing-work";
const TITLE = "Settings Dark Mode";
const EXPECTED_BRANCH = "treq/settings-dark-mode";

// Scenario: end-to-end review of creating a workspace from the home repo via
// the "Stack" dialog. The home repo has one uncommitted file so the dialog's
// Changes panel has something to show, and one pre-existing workspace so the
// "branch already exists" warning can be exercised.
it("captures the workspace creation flow from the home repo", async () => {
  const { repoPath } = createTestRepo(false);
  openRepo(repoPath);

  // Incidental background state, not part of the flow under test.
  await createWorkspace(repoPath, EXISTING_BRANCH);
  fs.writeFileSync(
    path.join(repoPath, "dark-mode.css"),
    "body { background: #111; }\n",
  );

  const user = userEvent.setup();
  render(<Dashboard />);

  await screen.findByTestId("show-workspace-header");
  const stackButton = await screen.findByRole("button", { name: "Stack" });
  await captureDocument(document, {
    name: "workspace-creation-flow-01-home",
    expectations: [
      "The home repo view is shown with a 'Stack' button in the header.",
      "The sidebar lists the pre-existing 'treq/existing-work' workspace.",
    ],
  });

  await user.click(stackButton);
  const dialog = await screen.findByTestId("modal");
  await within(dialog).findByText("Stack a new Workspace");
  const submit = within(dialog).getByRole("button", {
    name: "Create Workspace",
  });
  expect(submit).toBeDisabled();
  const moveToggle = within(dialog).getByRole("button", {
    name: "Move to workspace",
  });
  expect(moveToggle).toHaveAttribute("aria-expanded", "false");
  await captureDocument(document, {
    name: "workspace-creation-flow-02-dialog-empty",
    expectations: [
      "A single-column 'Stack a new Workspace' dialog shows Title, a two-row Description, Advanced and Branch Name fields.",
      "Below the fields, a collapsed 'Move to workspace' row with a right-pointing chevron; no Commits/Changes tabs are visible.",
      "The 'Create Workspace' button is disabled (greyed) because no branch name is set.",
    ],
  });

  await user.type(within(dialog).getByLabelText("Title (optional)"), TITLE);
  await user.type(
    within(dialog).getByLabelText("Description (optional)"),
    "Add dark mode to settings.{Enter}Cover the header, sidebar and dialogs.{Enter}Respect the OS theme by default.{Enter}Persist the choice per user.",
  );
  const branchInput = within(dialog).getByLabelText("Branch Name");
  await waitFor(() => expect(branchInput).toHaveValue(EXPECTED_BRANCH));
  await waitFor(() => expect(submit).toBeEnabled());
  // Let the debounced branch-exists check settle.
  await new Promise((resolve) => setTimeout(resolve, 800));
  await captureDocument(document, {
    name: "workspace-creation-flow-03-filled",
    expectations: [
      `The Branch Name field is auto-filled with '${EXPECTED_BRANCH}' derived from the title, with a green check (new branch).`,
      "The Description box has grown to show all four typed lines with no scrollbar or clipped text.",
      "The 'Create Workspace' button is enabled.",
    ],
  });

  await user.click(moveToggle);
  await within(dialog).findByRole("tab", { name: /^Changes/ });
  await user.click(within(dialog).getByRole("tab", { name: /^Changes/ }));
  await within(dialog).findByText("dark-mode.css");
  await captureDocument(document, {
    name: "workspace-creation-flow-03b-move-expanded",
    expectations: [
      "The 'Move to workspace' row now has a down chevron and shows Commits/Changes tabs beneath the form fields, full dialog width.",
      "The Changes tab is active and lists dark-mode.css.",
      "The footer (Cancel / Create Workspace) is still visible; the body scrolls if content is taller than the viewport.",
    ],
  });
  await user.click(moveToggle);

  await user.click(within(dialog).getByRole("button", { name: "Advanced" }));
  await user.type(
    await within(dialog).findByLabelText(/Sparse paths/),
    "src/settings{Enter}src/theme{Enter}src/components/ui",
  );
  await captureDocument(document, {
    name: "workspace-creation-flow-04-advanced",
    expectations: [
      "The Advanced section is expanded; the Sparse paths box has grown to show all three typed lines.",
      "The dialog still fits the viewport without clipped fields or footer buttons.",
    ],
  });

  await user.clear(branchInput);
  await user.type(branchInput, EXISTING_BRANCH);
  await within(dialog).findByText("Branch already exists locally");
  await captureDocument(document, {
    name: "workspace-creation-flow-05-branch-exists",
    expectations: [
      "Under the Branch Name field, yellow text reads 'Branch already exists locally' with a yellow alert icon in the input.",
    ],
  });

  await user.clear(branchInput);
  await user.type(branchInput, EXPECTED_BRANCH);
  await within(dialog).findByText("Stack a new Workspace");
  await waitFor(() =>
    expect(
      within(dialog).queryByText("Branch already exists locally"),
    ).not.toBeInTheDocument(),
  );
  await user.click(submit);
  await waitFor(() => {
    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
  });

  const header = await screen.findByTestId("show-workspace-header");
  await within(header).findByText(EXPECTED_BRANCH);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await captureDocument(document, {
    name: "workspace-creation-flow-06-created",
    expectations: [
      `The workspace header shows the new branch '${EXPECTED_BRANCH}' (or its title '${TITLE}').`,
      "The sidebar lists the new workspace alongside 'treq/existing-work', with the new one selected.",
      "A success toast or no error message is visible; nothing indicates failure.",
    ],
  });
}, 90000);
