import * as React from "react";
import { expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { createTestRepo, openRepo } from "../../../test/utils";
import { render, screen, waitFor, within } from "../../../test/test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import { createWorkspace } from "../../../src/lib/api";
import { captureDocument } from "../capture";

const BRANCH_NAME = "feat/prompt-history-demo";
const PROMPT_TEXT = "Build the login page and wire it to the auth API";

it("captures the workspace details starting prompt and the prompt history modal", async () => {
	const { repoPath } = createTestRepo(false);
	openRepo(repoPath);
	await createWorkspace(repoPath, BRANCH_NAME);

	const user = userEvent.setup();
	render(<Dashboard />);

	await user.click(await screen.findByText(BRANCH_NAME));
	await screen.findByTestId("show-workspace-header");

	// Submit a prompt through the real TaskInput, exactly as a user would,
	// which creates a session and (per the new feature) records the prompt.
	const taskTextarea = await screen.findByPlaceholderText("Describe a task...");
	await user.type(taskTextarea, PROMPT_TEXT);
	await user.click(await screen.findByRole("button", { name: /^edit$/i }));

	// Wait for the prompt to actually persist before opening Details.
	await new Promise((resolve) => setTimeout(resolve, 500));

	const detailsButton = await screen.findByTestId("workspace-details-button");
	await user.click(detailsButton);
	await screen.findByTestId("workspace-starting-prompt-text");

	await captureDocument(document, {
		name: "prompt-history-01-workspace-details-starting-prompt",
		expectations: [
			"An open popover titled 'Workspace details' shows the workspace's branch name and a 'Starting prompt' section.",
			`The Starting prompt section displays the text "${PROMPT_TEXT}" along with a Copy button next to the heading.`,
		],
	});

	// Close the popover, then open the command palette and jump to Prompt History.
	await user.click(detailsButton);
	await waitFor(() =>
		expect(
			screen.queryByTestId("workspace-details-popover"),
		).not.toBeInTheDocument(),
	);
	await user.keyboard("{Meta>}k{/Meta}");
	await screen.findByTestId("modal");

	await user.click(await screen.findByText("View Prompt History"));
	const promptHistoryModal = await screen.findByTestId("prompt-history-modal");
	await within(promptHistoryModal).findByText(PROMPT_TEXT);

	await captureDocument(document, {
		name: "prompt-history-02-modal-with-entries",
		expectations: [
			"A dialog titled 'Prompt History' is open, listing at least one prompt entry labeled with the workspace name feat/prompt-history-demo.",
			`The entry's full text "${PROMPT_TEXT}" is visible, each entry has its own Copy button, and a 'Copy all' button is visible near the title.`,
		],
	});
}, 60000);
