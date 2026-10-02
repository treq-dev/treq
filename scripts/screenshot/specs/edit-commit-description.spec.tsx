import * as React from "react";
import { expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import {
	commitWorkspaceFile,
	createTestRepo,
	notifyWorkspaceChanged,
	openRepo,
} from "../../../test/utils";
import { render, screen, waitFor, within } from "../../../test/test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import { getWorkspaces } from "../../../src/lib/api";
import { captureDocument } from "../capture";

const BRANCH_NAME = "feat/edit-description-demo";

// Scenario: the user creates a workspace via the home repo's "Stack" button,
// makes 2 workspace commits (the first is no longer @ once the second lands,
// so it shows up as a real, non-tentative commit row), opens the Commits tab,
// expands that first commit, and edits its description via the new
// "Edit description" action.
it("captures editing an existing commit's description from the Commits tab", async () => {
	const { repoPath } = createTestRepo(false);
	openRepo(repoPath);

	const user = userEvent.setup();
	render(<Dashboard />);

	await screen.findByTestId("show-workspace-header");
	await user.click(await screen.findByRole("button", { name: "Stack" }));

	const createDialog = await screen.findByTestId("modal");
	const branchNameInput = within(createDialog).getByLabelText("Branch Name");
	await user.type(branchNameInput, BRANCH_NAME);
	await user.click(
		within(createDialog).getByRole("button", { name: "Create Workspace" }),
	);
	await waitFor(() => {
		expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
	});

	const header = await screen.findByTestId("show-workspace-header");
	await within(header).findByText(BRANCH_NAME);

	const workspace = (await getWorkspaces(repoPath)).find(
		(candidate) => candidate.branch_name === BRANCH_NAME,
	);
	if (!workspace) {
		throw new Error(`Expected ${BRANCH_NAME} workspace to exist`);
	}

	await commitWorkspaceFile(
		repoPath,
		{ id: workspace.id, path: workspace.workspace_path },
		"workspace-file-1.txt",
		"workspace commit content 1",
		"Original description",
	);
	await commitWorkspaceFile(
		repoPath,
		{ id: workspace.id, path: workspace.workspace_path },
		"workspace-file-2.txt",
		"workspace commit content 2",
		"Workspace commit 2",
	);

	await user.click(await screen.findByRole("tab", { name: /^Commits/ }));
	notifyWorkspaceChanged(workspace.id);
	await screen.findByText("Workspace commit 2");
	const commitRow = await screen.findByText("Original description");

	await user.click(commitRow);
	const editButton = await screen.findByRole("button", {
		name: "Edit description",
	});

	await captureDocument(document, {
		name: "edit-commit-description-01-expanded-row",
		expectations: [
			"The Commits tab is active, showing the expanded 'Original description' commit row with its diff visible.",
			"The action bar for the expanded row shows 'Edit description', 'Move commit', and 'Delete commit' buttons.",
		],
	});

	await user.click(editButton);

	const editDialog = await screen.findByTestId("modal");
	await within(editDialog).findByText("Edit Commit Description");
	const textarea = await within(editDialog).findByDisplayValue(
		"Original description",
	);

	await captureDocument(document, {
		name: "edit-commit-description-02-dialog-open",
		expectations: [
			"A dialog titled 'Edit Commit Description' is open, with a subtitle naming the commit's short id.",
			"The textarea is pre-filled with the text 'Original description'.",
		],
	});

	await user.clear(textarea);
	await user.type(textarea, "Updated description via edit dialog");
	await user.click(within(editDialog).getByRole("button", { name: /save/i }));

	await waitFor(() => {
		expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
	});
	await screen.findByText("Description updated");
	await screen.findByText("Updated description via edit dialog");

	await captureDocument(document, {
		name: "edit-commit-description-03-after-save",
		expectations: [
			"The dialog is closed and the commit row now reads 'Updated description via edit dialog' instead of 'Original description'.",
			"A success toast in the bottom-left corner reads 'Description updated'.",
		],
	});
}, 60000);
