import * as React from "react";
import { expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { ask } from "@tauri-apps/plugin-dialog";
import {
	commitWorkspaceFile,
	createTestRepo,
	openRepo,
} from "../../../test/utils";
import { render, screen, waitFor, within } from "../../../test/test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import { getWorkspaces } from "../../../src/lib/api";
import { captureDocument } from "../capture";

const BRANCH_NAME = "feat/undo-revert-demo";

function rowFor(commitId: string): HTMLElement {
	const el = document.querySelector(`[data-commit-id="${commitId}"]`);
	if (!el) throw new Error(`No row found for commit ${commitId}`);
	return el as HTMLElement;
}

// Scenario: the user creates a workspace via the home repo's "Stack" button,
// makes 2 workspace commits, opens the Commits tab, and exercises the new
// "Undo commit" (only valid on the latest commit in the lineage) and
// "Revert commit" (valid on any commit) actions.
it("captures undoing and reverting commits from the Commits tab", async () => {
	vi.mocked(ask).mockResolvedValue(true);

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
		"a.txt",
		"content a",
		"First commit",
	);
	await commitWorkspaceFile(
		repoPath,
		{ id: workspace.id, path: workspace.workspace_path },
		"b.txt",
		"content b",
		"Second commit",
	);

	await user.click(await screen.findByRole("tab", { name: "Commits" }));
	await screen.findByText("Second commit");
	await screen.findByText("First commit");

	// Expand the newest commit — it should offer "Undo commit".
	const secondCommitHeader = await screen.findByText("Second commit");
	await user.click(secondCommitHeader);
	const secondCommitRowEl = secondCommitHeader.closest(
		"[data-commit-id]",
	) as HTMLElement;
	const secondCommitId = secondCommitRowEl.getAttribute("data-commit-id")!;
	await within(rowFor(secondCommitId)).findByRole("button", {
		name: "Undo commit",
	});

	await captureDocument(document, {
		name: "undo-revert-commit-01-latest-expanded",
		expectations: [
			"The Commits tab is active, showing the expanded 'Second commit' row.",
			"The action bar for the expanded row includes an 'Undo commit' button alongside 'Edit description', 'Revert commit', 'Move commit', and 'Delete commit'.",
		],
	});

	// Collapse it, then expand the older commit — no "Undo commit" there,
	// but "Revert commit" is still available.
	await user.click(secondCommitHeader);
	const firstCommitHeader = await screen.findByText("First commit");
	await user.click(firstCommitHeader);
	const firstCommitRowEl = firstCommitHeader.closest(
		"[data-commit-id]",
	) as HTMLElement;
	const firstCommitId = firstCommitRowEl.getAttribute("data-commit-id")!;
	await within(rowFor(firstCommitId)).findByRole("button", {
		name: "Revert commit",
	});
	expect(
		within(rowFor(firstCommitId)).queryByRole("button", {
			name: "Undo commit",
		}),
	).not.toBeInTheDocument();

	await captureDocument(document, {
		name: "undo-revert-commit-02-older-expanded-no-undo",
		expectations: [
			"The expanded 'First commit' row's action bar shows 'Revert commit' but does NOT show an 'Undo commit' button.",
		],
	});

	// Revert the older commit.
	await user.click(
		within(rowFor(firstCommitId)).getByRole("button", {
			name: "Revert commit",
		}),
	);
	await screen.findByText("Commit reverted");
	await screen.findByText(/^Revert "First commit"/);

	await captureDocument(document, {
		name: "undo-revert-commit-03-after-revert",
		expectations: [
			"A success toast reading 'Commit reverted' is visible.",
			"The commit list now shows a new top commit whose title starts with 'Revert \"First commit\"', above 'Second commit' and 'First commit'.",
		],
	});

	// Undo the now-latest commit (the revert commit itself).
	const revertCommitHeader = await screen.findByText(
		/^Revert "First commit"/,
	);
	await user.click(revertCommitHeader);
	const revertRowEl = revertCommitHeader.closest(
		"[data-commit-id]",
	) as HTMLElement;
	const revertCommitId = revertRowEl.getAttribute("data-commit-id")!;
	await user.click(
		within(rowFor(revertCommitId)).getByRole("button", {
			name: "Undo commit",
		}),
	);
	await screen.findByText("Commit undone");

	await waitFor(() => {
		expect(
			screen.queryByText(/^Revert "First commit"/),
		).not.toBeInTheDocument();
	});

	await captureDocument(document, {
		name: "undo-revert-commit-04-after-undo",
		expectations: [
			"A success toast reading 'Commit undone' is visible.",
			"The revert commit is gone from the list, leaving 'Second commit' and 'First commit'.",
		],
	});
}, 60000);
