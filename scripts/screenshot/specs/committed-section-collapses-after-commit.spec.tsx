import * as React from "react";
import { expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import {
	commitWorkspaceFile,
	createTestRepo,
	notifyWorkspaceChanged,
	openRepo,
	resolveWorkspacePath,
	writeWorkspaceFile,
} from "../../../test/utils";
import { render, screen, waitFor, within } from "../../../test/test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import { getWorkspaces } from "../../../src/lib/api";
import { captureDocument } from "../capture";

const BRANCH_NAME = "feat/committed-collapse";

// Scenario: a workspace already has one committed change (so the "Committed"
// section renders, expanded by default) plus a new uncommitted change. The
// user commits the uncommitted change from the Changes tab, and the
// "Committed" section should collapse automatically instead of staying
// expanded and pushing the newly-committed file into view unannounced.
it("collapses the Committed section automatically after a commit", async () => {
	const { repoPath } = createTestRepo(false);
	openRepo(repoPath);

	const user = userEvent.setup();
	render(<Dashboard />);

	await screen.findByTestId("show-workspace-header");
	await user.click(await screen.findByRole("button", { name: "Stack" }));
	const dialog = await screen.findByTestId("modal");
	await user.type(within(dialog).getByLabelText("Branch Name"), BRANCH_NAME);
	await user.click(
		within(dialog).getByRole("button", { name: "Create Workspace" }),
	);
	await waitFor(() => {
		expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
	});

	const workspace = (await getWorkspaces(repoPath)).find(
		(candidate) => candidate.branch_name === BRANCH_NAME,
	);
	if (!workspace) {
		throw new Error(`Expected ${BRANCH_NAME} workspace to exist`);
	}

	await commitWorkspaceFile(
		repoPath,
		{ id: workspace.id, path: workspace.workspace_path },
		"already-committed.txt",
		"pre-existing committed content",
		"Pre-existing commit",
	);

	writeWorkspaceFile(
		resolveWorkspacePath(repoPath, workspace.workspace_path),
		"new-change.txt",
		"a new uncommitted line\n",
	);

	await user.click(await screen.findByRole("tab", { name: /Changes/ }));
	notifyWorkspaceChanged(workspace.id);
	await screen.findAllByText("new-change.txt");
	await screen.findAllByText("already-committed.txt");

	const findCommittedToggle = () =>
		screen
			.getAllByRole("button", { name: /^Committed/ })
			.find(
				(button) =>
					button.querySelector("svg.lucide-chevron-down") ||
					button.querySelector("svg.lucide-chevron-right"),
			);

	const committedToggle = findCommittedToggle();
	expect(committedToggle?.querySelector("svg.lucide-chevron-down")).not.toBeNull();

	await captureDocument(document, {
		name: "committed-section-collapse-01-before-commit",
		expectations: [
			"The left sidebar shows a 'Changes' section with new-change.txt and, below it, a 'Committed' section that is expanded (down chevron) showing already-committed.txt.",
			"A commit message box with placeholder 'Message' and a 'Commit' button are visible below the file sections.",
		],
	});

	await user.type(
		await screen.findByPlaceholderText("Message"),
		"Commit the new change",
	);
	await user.click(screen.getByRole("button", { name: "Commit" }));

	await screen.findByText("Commit created");
	await waitFor(() => {
		const toggle = findCommittedToggle();
		expect(toggle?.querySelector("svg.lucide-chevron-right")).not.toBeNull();
	});

	await captureDocument(document, {
		name: "committed-section-collapse-02-after-commit",
		expectations: [
			"The 'Committed' section header is visible with a right-pointing chevron (collapsed state), and no file rows are shown underneath it.",
			"A 'Commit created' toast is visible confirming the commit succeeded.",
		],
	});
}, 60000);
