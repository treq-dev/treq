/**
 * Captures the agent terminal header with the new scroll-to-bottom icon
 * button immediately to the left of the Reset (restart) button.
 */

import * as React from "react";
import { expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { createTestRepo, findSidebarBranchElement, openRepo } from "../../../test/utils";
import { createWorkspace, getWorkspaces } from "../../../src/lib/api";
import { render, screen, waitFor, within } from "../../../test/test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import { captureDocument } from "../capture";

const BRANCH_NAME = "feat/scroll-down-btn";

it("agent terminal header shows scroll-to-bottom left of reset", async () => {
	const { repoPath } = createTestRepo(false);
	openRepo(repoPath);

	await createWorkspace(repoPath, BRANCH_NAME);
	const workspaces = await getWorkspaces(repoPath);
	const workspace = workspaces.find((w) => w.branch_name === BRANCH_NAME);
	if (!workspace) throw new Error(`workspace ${BRANCH_NAME} not found`);

	const user = userEvent.setup();
	render(<Dashboard />);

	await user.click(await findSidebarBranchElement(workspace.branch_name));
  await screen.findByTestId("workspace-terminal-pane");

	await user.keyboard("{Meta>}]{/Meta}");

	const terminalPanel = await waitFor(() => {
		const el = document.querySelector('[data-terminal-id^="claude-"]');
		expect(el).not.toBeNull();
		return el as HTMLElement;
	});

	const scrollButton = within(terminalPanel).getByLabelText(/scroll to bottom/i);
	const resetButton = within(terminalPanel).getByLabelText(/reset terminal/i);
	expect(
		scrollButton.compareDocumentPosition(resetButton) &
			Node.DOCUMENT_POSITION_FOLLOWING,
	).toBeTruthy();

	await captureDocument(document, {
		name: "agent-terminal-scroll-down-01-header",
		expectations: [
			"Agent terminal header shows an ArrowDownToLine scroll-to-bottom icon button.",
			"The scroll-to-bottom button sits immediately to the left of the Reset (RotateCw) button.",
			"Search and Close icon buttons remain to the right of Reset.",
		],
	});
}, 60000);
