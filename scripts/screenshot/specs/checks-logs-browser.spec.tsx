import * as React from "react";
import { it } from "vitest";
import userEvent from "@testing-library/user-event";
import { createTestRepo, openRepo, writeRepoFile } from "../../../test/utils";
import { render, screen, waitFor, within } from "../../../test/test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import { createWorkspace, trustRepo } from "../../../src/lib/api";
import { captureDocument } from "../capture";

// Emits info, warning and error lines so the level colouring is visible, and
// two steps so the step filter has something to switch between.
const LOGGING_WORKFLOW = `
name: Pull request checks
on:
  workflow_dispatch: {}
jobs:
  build:
    name: Build Job
    steps:
      - name: Compile
        run: "echo 'Compiling treq v0.1.3'; echo 'warning: unused variable x'"
      - name: Test
        run: "echo 'running 2 tests'; echo 'error: assertion failed' 1>&2; exit 1"
`;

it("captures the checks run history and the logs browser", async () => {
	const { repoPath } = createTestRepo(false);
	openRepo(repoPath);
	await createWorkspace(repoPath, "feat/logs");
	await writeRepoFile(repoPath, ".treq/workflows/ci.yaml", LOGGING_WORKFLOW);
	await trustRepo(repoPath);

	const user = userEvent.setup();
	render(<Dashboard />);

	const sidebar = document.querySelector(
		`.${CSS.escape("group/sidebar")}`,
	) as HTMLElement;
	await waitFor(() => {
		if (within(sidebar).queryAllByText("feat/logs").length === 0) {
			throw new Error("workspace not in sidebar yet");
		}
	});
	await user.click(within(sidebar).getAllByText("feat/logs")[0]);
	await user.click(await screen.findByRole("tab", { name: /^Checks/ }));
	await screen.findByRole("tab", { name: /^Checks/, selected: true });
	await screen.findByText("Build Job");

	// Run once, then again, so the history shows two distinct run items.
	await user.click(await screen.findByRole("button", { name: /Run Build Job/i }));
	await screen.findByTestId("run-history-item");
	await user.click(await screen.findByRole("button", { name: /Run Build Job/i }));
	await waitFor(async () => {
		const items = await screen.findAllByTestId("run-history-item");
		if (items.length !== 2) throw new Error(`expected 2 runs, got ${items.length}`);
	});

	await captureDocument(document, {
		name: "checks-logs-01-run-history",
		expectations: [
			'A "Run history" section is visible at the bottom of the workflow card listing two separate run entries, each with a "#<number>" id and a timestamp.',
			"Both run entries show a red X status icon, because the job's second step exits with an error.",
			'Each run entry has a "build" button with a document icon for opening that run\'s logs.',
			'The "Build Job" step rows above show a green checkmark on "Compile" and a red X on "Test".',
		],
	});

	// Open the newest run's logs.
	await user.click((await screen.findAllByRole("button", { name: /^Logs/ }))[0]);
	const browser = await screen.findByTestId("logs-browser");
	await screen.findByText("Compiling treq v0.1.3");

	await captureDocument(document, {
		name: "checks-logs-02-browser",
		expectations: [
			"A logs viewer is open, replacing the checks list, with a Back button and an Export button in its header.",
			"Every log line is rendered in a monospace font with a timestamp in a left-hand column.",
			'The line "warning: unused variable x" is amber/yellow and "error: assertion failed" is red.',
			'Plain lines such as "Compiling treq v0.1.3" and "running 2 tests" are rendered in the default text colour, not amber or red.',
			'A filter row shows "all", "info", "warning" and "error" buttons plus a step dropdown and a search box.',
		],
	});

	// Filter down to error lines only.
	await user.click(within(browser).getByRole("button", { name: "error" }));
	await waitFor(() => {
		const lines = document.querySelectorAll('[data-testid="log-line"]');
		if (lines.length !== 1) throw new Error(`expected 1 line, got ${lines.length}`);
	});

	await captureDocument(document, {
		name: "checks-logs-03-error-filter",
		expectations: [
			'Exactly one log line is shown — the red "error: assertion failed" line.',
			'The "error" filter button is visually selected/highlighted compared to the other filter buttons.',
			'The info and warning lines from the previous screenshot are gone.',
		],
	});
}, 90000);
