import * as React from "react";
import { it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent } from "@testing-library/react";
import { ask } from "@tauri-apps/plugin-dialog";
import {
	createTestRepo,
	findSidebarBranchElement,
	openRepo,
} from "../../../test/utils";
import { render, screen, waitFor } from "../../../test/test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import { createWorkspace } from "../../../src/lib/api";
import { captureDocument } from "../capture";

// Reference: every interaction goes through @testing-library/user-event
// (never fireEvent), except the right-click gesture itself -- Radix's
// context-menu trigger has no userEvent equivalent for that event, matching
// the established pattern in test/integration/sidebar.test.tsx.
it("captures archiving a workspace, bulk-archiving, and restoring from the Archived Workspaces modal", async () => {
	const { repoPath } = createTestRepo(false);
	openRepo(repoPath);
	await createWorkspace(repoPath, "feat/archive-single");
	await createWorkspace(repoPath, "feat/bulk-a");
	await createWorkspace(repoPath, "feat/bulk-b");

	vi.mocked(ask).mockResolvedValue(true);

	const user = userEvent.setup();
	render(<Dashboard />);

	await findSidebarBranchElement("feat/archive-single");
	await findSidebarBranchElement("feat/bulk-a");
	await findSidebarBranchElement("feat/bulk-b");

	// --- Single-workspace archive via the sidebar context menu ---
	const singleElement = await findSidebarBranchElement("feat/archive-single");
	fireEvent.contextMenu(singleElement);
	await screen.findByText("Archive Workspace");
	await captureDocument(document, {
		name: "workspace-archive-restore-01-context-menu",
		expectations: [
			'The open right-click context menu for "feat/archive-single" includes an "Archive Workspace" item with an archive-box icon.',
			'The menu also shows "Rename Workspace" above it and "Delete Workspace" below it.',
		],
	});

	await user.click(await screen.findByText("Archive Workspace"));
	await waitFor(() => {
		expect(
			screen.queryByText("feat/archive-single"),
		).not.toBeInTheDocument();
	});
	await captureDocument(document, {
		name: "workspace-archive-restore-02-single-archived",
		expectations: [
			'The sidebar workspace list no longer shows "feat/archive-single".',
			'The remaining workspaces "feat/bulk-a" and "feat/bulk-b" are still listed.',
		],
	});

	// --- Multi-select two workspaces and bulk-archive them ---
	const a = await findSidebarBranchElement("feat/bulk-a");
	const b = await findSidebarBranchElement("feat/bulk-b");
	await user.keyboard("{Meta>}");
	await user.click(a);
	await user.click(b);
	await user.keyboard("{/Meta}");

	await screen.findByText(/Archive 2 workspaces/);
	await captureDocument(document, {
		name: "workspace-archive-restore-03-bulk-select-toolbar",
		expectations: [
			'Both "feat/bulk-a" and "feat/bulk-b" are highlighted as selected in the sidebar.',
			'A toolbar row at the bottom of the workspace list shows an "Archive 2 workspaces" button next to a "Delete 2 workspaces" button.',
		],
	});

	await user.click(await screen.findByText(/Archive 2 workspaces/));
	await waitFor(() => {
		expect(screen.queryByText("feat/bulk-a")).not.toBeInTheDocument();
		expect(screen.queryByText("feat/bulk-b")).not.toBeInTheDocument();
	});
	await captureDocument(document, {
		name: "workspace-archive-restore-04-bulk-archived",
		expectations: [
			"The sidebar workspace list is now empty of the three created workspaces (only the home repo row remains).",
		],
	});

	// --- Open the Archived Workspaces modal from the command palette ---
	await user.keyboard("{Control>}k{/Control}");
	await user.click(await screen.findByText("Archived Workspaces"));

	await screen.findByText("feat/archive-single");
	await screen.findByText("feat/bulk-a");
	await screen.findByText("feat/bulk-b");
	await captureDocument(document, {
		name: "workspace-archive-restore-05-modal-list",
		expectations: [
			'A modal titled "Archived Workspaces" is open, listing "feat/archive-single", "feat/bulk-a", and "feat/bulk-b" each with a "Restore" button.',
			"The modal explains archived workspaces are removed from the workspaces directory but kept in the database.",
		],
	});

	// --- Restore one workspace back ---
	const restoreButtons = await screen.findAllByRole("button", {
		name: "Restore",
	});
	await user.click(restoreButtons[0]);
	await waitFor(() => {
		expect(screen.queryAllByRole("button", { name: "Restore" }).length).toBe(
			2,
		);
	});
	await captureDocument(document, {
		name: "workspace-archive-restore-06-after-restore",
		expectations: [
			"The Archived Workspaces modal now lists only two remaining archived workspaces instead of three.",
		],
	});
}, 60000);
