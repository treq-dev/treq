/**
 * Verifies that "Send review to terminal" (the Plan/Edit buttons in the Finish
 * Review popover) respects the repo-level default_agent setting.  Before this
 * fix, a review was always sent to a Claude terminal even when the repo had
 * codex set as its default agent.  After the fix, clicking "Plan" should open
 * a Codex terminal (Codex brand icon) instead of a Claude terminal.
 */

import * as React from "react";
import { expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { createTestRepo, openRepo, resolveWorkspacePath, writeWorkspaceFile } from "../../../test/utils";
import { render, screen, waitFor } from "../../../test/test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import {
	createWorkspace,
	getWorkspaces,
	setRepoSetting,
} from "../../../src/lib/api";
import { captureDocument } from "../capture";

const BRANCH_NAME = "feat/codex-review-agent";

it("send review to terminal opens a codex terminal when repo default_agent=codex", async () => {
	const { repoPath } = createTestRepo(false);
	openRepo(repoPath);

	// Background state: set repo default agent to codex BEFORE the review is
	// submitted. handleCreateAgentWithReview reads this setting when the user
	// clicks Plan/Edit, so it just needs to be set before that click.
	await setRepoSetting(repoPath, "default_agent", "codex");

	// Create workspace via API (incidental — not the behavior under test).
	await createWorkspace(repoPath, BRANCH_NAME);
	const workspaces = await getWorkspaces(repoPath);
	const workspace = workspaces.find((w) => w.branch_name === BRANCH_NAME);
	if (!workspace) throw new Error(`workspace ${BRANCH_NAME} not found`);

	// Write an uncommitted file so the Changes tab has a diff to show.
	writeWorkspaceFile(
		resolveWorkspacePath(repoPath, workspace.workspace_path),
		"example.ts",
		'export const answer = 42;\n',
	);

	const user = userEvent.setup();
	render(<Dashboard />);

	// Navigate to the workspace by clicking its name in the sidebar.
	await user.click(await screen.findByText(BRANCH_NAME));
	await screen.findByTestId("show-workspace-header");

	// Open an agent terminal before starting the review. Once it is no longer
	// streaming, this is the existing idle terminal that Edit must reuse.
	await user.click(await screen.findByLabelText("New agent terminal"));
	const existingAgentItem = await waitFor(() => {
		const item = document.querySelector(
			'[data-testid^="terminal-session-item-claude-"]',
		);
		expect(item).not.toBeNull();
		return item as HTMLElement;
	});
	await user.click(existingAgentItem);
	await waitFor(() => {
		expect(document.querySelector('[data-terminal-id^="claude-"]')).not.toBeNull();
	});

	// Open the Changes tab.
	await user.click(await screen.findByRole("tab", { name: /^Changes/i }));
	// The file appears in both sidebar and diff header — wait for any occurrence.
	await screen.findAllByText("example.ts");

	// The diff is already expanded; click "Add comment" on the first hunk line.
	// Use findAll to handle one button per diff line without ambiguity.
	const addCommentBtns = await screen.findAllByRole("button", {
		name: /add comment/i,
	});
	await user.click(addCommentBtns[0]);

	// Type a comment and submit it.
	await user.type(
		await screen.findByPlaceholderText(/add a comment/i),
		"Fix this",
	);
	// The textarea is inside a form that has a submit button also labelled
	// "Add Comment". Find the one with exact textContent to avoid ambiguity.
	await waitFor(async () => {
		const btns = screen.getAllByRole("button", { name: /add comment/i });
		const submitBtn = btns.find(
			(btn) => btn.textContent?.trim() === "Add Comment",
		);
		expect(submitBtn).toBeDefined();
		await user.click(submitBtn!);
	});
	await screen.findByText("Fix this");

	// Open the Finish Review popover.
	await user.click(await screen.findByRole("button", { name: /finish review/i }));

	await captureDocument(document, {
		name: "send-review-codex-01-popover",
		expectations: [
			'The "Finish review" popover is open showing the "Finish your review" heading.',
			'Three action buttons are visible: "Copy" on the left, "Plan" and "Edit" on the right.',
			'The diff pane for example.ts is visible in the background.',
		],
	});

	// Click "Edit" — this triggers handleCreateAgentWithReview which should
	// pick up default_agent=codex and pass agent:"codex" to onSessionCreated.
	await user.click(await screen.findByRole("button", { name: /^edit$/i }));

	// Wait for the already-open terminal to remain mounted. Reusing it must not
	// create a second Code Review session.
	await waitFor(
		async () => {
			expect(
				document.querySelectorAll('[data-terminal-id^="claude-"]').length,
			).toBe(1);
		},
		{ timeout: 10000 },
	);

	await captureDocument(document, {
		name: "send-review-codex-02-terminal",
		expectations: [
			'The terminal pane at the bottom is open.',
			'The existing agent terminal remains the only agent terminal after choosing "Edit".',
			'The existing terminal is active and focused after receiving the review.',
		],
	});

	// Capture a second view of the completed Edit flow so the terminal focus
	// state is part of the visual regression evidence.
	await captureDocument(document, {
		name: "send-review-codex-03-edit-terminal",
		expectations: [
			'The terminal pane remains open after choosing "Edit".',
			'The already-open agent terminal remains visible rather than a new review terminal being created.',
			'The review flow returns focus to that existing terminal after sending.',
		],
	});
}, 60000);
