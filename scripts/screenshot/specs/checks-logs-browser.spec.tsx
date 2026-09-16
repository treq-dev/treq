import * as React from "react";
import { it } from "vitest";
import userEvent from "@testing-library/user-event";
import { createTestRepo, openRepo, writeRepoFile } from "../../../test/utils";
import { render, screen, waitFor, within } from "../../../test/test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import {
	createWorkspace,
	getWorkspaces,
	runWorkflow,
	trustRepo,
} from "../../../src/lib/api";
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

it("captures check inspection in the Logs tab", async () => {
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
	const workspace = (await getWorkspaces(repoPath)).find(
		(item) => item.branch_name === "feat/logs",
	);
	if (!workspace) throw new Error("workspace was not created");
	await runWorkflow(
		repoPath,
		"ci.yaml",
		workspace.id,
		workspace.workspace_path,
	);
	await user.click(await screen.findByRole("tab", { name: /^Logs/ }));
	await screen.findByRole("tab", { name: /^Logs/, selected: true });
	await screen.findByTestId("logs-tab");
	await screen.findByText("Compiling treq v0.1.3");

	await captureDocument(document, {
		name: "checks-logs-01-run-history",
		expectations: [
			'The workspace tab row contains a selected "Logs" tab instead of a standalone "Checks" tab.',
			'The Logs tab shows check output including "Compiling treq v0.1.3".',
			'The log browser provides level filtering and a search field for inspecting check output.',
		],
	});

}, 90000);
