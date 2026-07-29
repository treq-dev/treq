import * as React from "react";
import { it } from "vitest";
import userEvent from "@testing-library/user-event";
import { createTestRepo, openRepo, writeRepoFile } from "../../../test/utils";
import { render, screen, waitFor, within } from "../../../test/test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import { createWorkspace, trustRepo } from "../../../src/lib/api";
import { captureDocument } from "../capture";

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
        run: "echo 'running 2 tests'; echo 'error: assertion failed' 1>&2"
`;

it("captures the home repo Logs tab, level multi-select and SQL explorer", async () => {
	const { repoPath } = createTestRepo(false);
	openRepo(repoPath);
	await createWorkspace(repoPath, "feat/logs");
	await writeRepoFile(repoPath, ".treq/workflows/ci.yaml", LOGGING_WORKFLOW);
	await trustRepo(repoPath);

	const user = userEvent.setup();
	render(<Dashboard />);

	// Seed log rows by running the check inside the workspace.
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
	await user.click(await screen.findByRole("button", { name: /Run Build Job/i }));
	await screen.findByTestId("run-history-item");

	// Back to the home repo, where the Logs tab lives.
	await user.click(within(sidebar).getAllByText(/^branch-/)[0]);
	await user.click(await screen.findByRole("tab", { name: /^Logs/ }));
	await screen.findByRole("tab", { name: /^Logs/, selected: true });
	await screen.findByText("Compiling treq v0.1.3");

	await captureDocument(document, {
		name: "logs-tab-01-browse",
		expectations: [
			'A "Checks logs" data-source header is visible with the path ".treq/runs/**/*.jsonl" underneath it.',
			'The header has "Browse" and "SQL Explorer" toggle buttons, with "Browse" currently selected.',
			'Log lines are listed in a monospace font, each with a timestamp, a "#<run id>" column, a blue "build" job-id column, and the message.',
			'The warning line is amber and the error line is red; plain lines are the default colour.',
			'A level filter button reading "All levels" sits above the log lines next to a search box.',
		],
	});

	// Open the multi-select and tick two levels.
	// Radix positions its popper from measured element boxes, which jsdom always
	// reports as 0x0, so the menu rasterises at the top-left corner here. Its
	// placement is a harness artifact and is not something these shots can check.
	await user.click(await screen.findByTestId("log-level-filter"));
	await screen.findByRole("menuitemcheckbox", { name: /warning/i });

	await captureDocument(document, {
		name: "logs-tab-02-level-multiselect",
		expectations: [
			'An open dropdown lists "info", "warning" and "error" as checkbox items.',
			"None of the checkboxes are ticked yet, matching the \"All levels\" button label.",
			"Ignore where the dropdown sits on the page: jsdom reports zero-sized boxes so Radix cannot anchor it to the trigger in this harness.",
		],
	});

	await user.click(await screen.findByRole("menuitemcheckbox", { name: /warning/i }));
	await user.click(await screen.findByRole("menuitemcheckbox", { name: /error/i }));
	await waitFor(() => {
		const lines = document.querySelectorAll('[data-testid="repo-log-line"]');
		if (lines.length !== 2) throw new Error(`expected 2 lines, got ${lines.length}`);
	});
	await user.keyboard("{Escape}");

	await captureDocument(document, {
		name: "logs-tab-03-two-levels-selected",
		expectations: [
			'The level filter button now reads "2 levels" instead of "All levels".',
			"Exactly two log lines remain: the amber warning line and the red error line.",
			'The plain info lines ("Compiling treq v0.1.3", "running 2 tests") are gone.',
		],
	});

	// Switch to the SQL explorer and run an aggregate query.
	await user.click(await screen.findByRole("button", { name: /SQL Explorer/i }));
	const explorer = await screen.findByTestId("logs-sql-explorer");
	await user.click(await screen.findByRole("button", { name: /Errors by job/i }));
	await user.click(within(explorer).getByRole("button", { name: /Run query/i }));
	await screen.findByTestId("sql-results");

	await captureDocument(document, {
		name: "logs-tab-04-sql-explorer",
		expectations: [
			"A SQL editor shows a multi-line GROUP BY query against the logs view, in a monospace font.",
			'A row of template buttons ("Recent lines", "Errors by job", "Lines per run") sits above the editor.',
			'A result grid is rendered below with column headers "job_id" and "errors", and a row containing "build".',
			'A row count line such as "1 row" appears above the grid.',
		],
	});
}, 90000);
