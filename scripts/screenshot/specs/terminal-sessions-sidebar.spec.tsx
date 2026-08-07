import * as React from "react";
import { expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { ask } from "@tauri-apps/plugin-dialog";
import {
	createTestRepo,
	findSidebarBranchElement,
	openRepo,
} from "../../../test/utils";
import { render, screen, waitFor, within } from "../../../test/test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import { createWorkspace } from "../../../src/lib/api";
import { captureDocument } from "../capture";

// Same setup as test/integration/workspace/terminal-pane.test.tsx: a real jj
// repo via NAPI, a real Dashboard render, real Rust dispatch under the hood.
it("captures the terminal sessions sidebar", async () => {
	const { repoPath } = createTestRepo(false);
	openRepo(repoPath);
	await createWorkspace(repoPath, "feat/terminal-sidebar-demo");

	const user = userEvent.setup();
	render(<Dashboard />);

	// Select the workspace so new terminals are created inside it (giving the
	// sidebar list a real branch name to display).
	await user.click(await findSidebarBranchElement("feat/terminal-sidebar-demo"));

	const newAgentButton = await screen.findByLabelText("New agent terminal");
	const newShellButton = await screen.findByLabelText("New shell terminal");
	const closeIdleButton = await screen.findByLabelText("Close idle terminals");
	const closeAllButton = await screen.findByLabelText("Close all terminals");

	await captureDocument(document, {
		name: "terminal-sessions-sidebar-01-empty",
		expectations: [
			"The bottom of the left sidebar has a 'SESSIONS' section header with 4 small icon buttons to its right (bot, terminal, moon, trash icons).",
			"The 'Close idle terminals' and 'Close all terminals' icon buttons look disabled/dimmed since there are no terminals yet, and no terminal list items are shown below the header.",
		],
	});

	// Create a shell terminal, then an agent terminal, from the sidebar buttons.
	await user.click(newShellButton);
	await waitFor(() => {
		expect(
			document.querySelector('[data-terminal-id^="shell-"]'),
		).not.toBeNull();
	});
	await waitFor(() => {
		expect(
			document.querySelector('[data-testid^="terminal-session-item-shell-"]'),
		).not.toBeNull();
	});

	await user.click(newAgentButton);
	await waitFor(() => {
		expect(
			document.querySelector('[data-terminal-id^="claude-"]'),
		).not.toBeNull();
	});
	const agentItem = await waitFor(() => {
		const el = document.querySelector(
			'[data-testid^="terminal-session-item-claude-"]',
		);
		expect(el).not.toBeNull();
		return el as HTMLElement;
	});

	await captureDocument(document, {
		name: "terminal-sessions-sidebar-02-two-terminals",
		expectations: [
			"The sidebar's terminal list shows two rows: one with a terminal icon labeled 'Shell', one with a bot icon labeled 'Claude' (or similar agent name), each followed by the branch name 'feat/terminal-sidebar-demo' (possibly truncated).",
			"The 'Close idle terminals' and 'Close all terminals' icon buttons no longer look disabled.",
			"Below the sidebar, the terminal pane at the bottom of the main content area is expanded and shows both a shell terminal panel and an agent terminal panel side by side.",
		],
	});

	// Click the agent's sidebar list item to focus/reveal that terminal.
	await user.click(agentItem);
	await waitFor(() => {
		const header = document.querySelector(
			'[data-terminal-id^="claude-"]',
		)?.firstElementChild;
		expect(header?.className).toMatch(/bg-primary/);
	});

	await captureDocument(document, {
		name: "terminal-sessions-sidebar-03-focused",
		expectations: [
			"In the terminal pane, the agent terminal panel's header bar is highlighted (a distinct tinted background) to show it is the focused/active terminal, while the shell terminal panel's header is not highlighted.",
		],
	});

	// Hover + close the shell terminal from its sidebar list item.
	const shellItem = document.querySelector(
		'[data-testid^="terminal-session-item-shell-"]',
	) as HTMLElement;
	await user.hover(shellItem);
	const closeShellButton = within(shellItem).getByLabelText("Close terminal");
	await user.click(closeShellButton);

	await waitFor(() => {
		expect(
			document.querySelector('[data-terminal-id^="shell-"]'),
		).not.toBeInTheDocument();
	});
	await waitFor(() => {
		expect(
			document.querySelector('[data-testid^="terminal-session-item-shell-"]'),
		).not.toBeInTheDocument();
	});

	await captureDocument(document, {
		name: "terminal-sessions-sidebar-04-after-close-one",
		expectations: [
			"The sidebar's terminal list now shows only one row (the agent terminal) -- the shell row is gone.",
		],
	});

	// Close all terminals: confirmation dialog is native (mocked), so assert
	// it was invoked with a confirmation message, then confirm it.
	vi.mocked(ask).mockResolvedValueOnce(true);
	await user.click(closeAllButton);

	await waitFor(() => {
		expect(ask).toHaveBeenCalledWith(
			expect.stringMatching(/close all terminal/i),
			expect.objectContaining({ title: expect.stringMatching(/close/i) }),
		);
	});
	await waitFor(() => {
		expect(
			document.querySelector('[data-testid^="terminal-session-item-"]'),
		).not.toBeInTheDocument();
	});

	await captureDocument(document, {
		name: "terminal-sessions-sidebar-05-after-close-all",
		expectations: [
			"The sidebar's terminal list is empty again (no rows), matching the initial empty state, after confirming 'Close all terminals'.",
		],
	});

	// Sanity: close-idle button doesn't error when there's nothing to close.
	await user.click(closeIdleButton);
}, 60000);
