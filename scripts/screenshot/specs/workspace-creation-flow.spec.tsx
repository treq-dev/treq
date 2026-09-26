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
  await captureDocument(document, {
    name: "workspace-creation-flow-02-dialog-empty",
    expectations: [
      "A 'Stack a new Workspace' dialog is open with Title, Description, Advanced and Branch Name fields on the left.",
      "The right panel shows commits/changes for the home repo; the uncommitted dark-mode.css change is listed under Changes if that tab is shown.",
      "The 'Create Workspace' button is disabled (greyed) because no branch name is set.",
    ],
  });

  await user.type(within(dialog).getByLabelText("Title (optional)"), TITLE);
  await user.type(
    within(dialog).getByLabelText("Description (optional)"),
    "Add dark mode to settings",
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
      "The tree preview shows the new workspace on top of the default branch.",
      "The 'Create Workspace' button is enabled.",
    ],
  });

  await user.click(within(dialog).getByRole("button", { name: "Advanced" }));
  await within(dialog).findByLabelText(/Sparse paths/);
  await captureDocument(document, {
    name: "workspace-creation-flow-04-advanced",
    expectations: [
      "The Advanced section is expanded, showing 'Sparse paths' and 'Symlink from home repo' textareas.",
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
