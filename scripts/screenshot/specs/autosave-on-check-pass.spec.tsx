import * as React from "react";
import { expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import {
	createTestRepo,
	notifyWorkspaceChanged,
	openRepo,
	resolveWorkspacePath,
	writeRepoFile,
	writeWorkspaceFile,
} from "../../../test/utils";
import { render, screen, waitFor, within } from "../../../test/test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import {
	getWorkspaces,
	runWorkflowJob,
	trustRepo,
} from "../../../src/lib/api";
import { captureDocument } from "../capture";

const BRANCH_NAME = "feat/autosave-check";

const PASSING_WORKFLOW = `
name: Passing CI
on:
  workflow_dispatch: {}
jobs:
  greet:
    name: Greet Job
    steps:
      - name: Say hello
        run: echo hello
      - name: Say world
        run: echo world
`;

it("captures autosave after a passing check and drop after a manual commit", async () => {
	const { repoPath } = createTestRepo(false);
	openRepo(repoPath);
	await writeRepoFile(repoPath, ".treq/workflows/ci.yaml", PASSING_WORKFLOW);

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
	const workspacePath = resolveWorkspacePath(
		repoPath,
		workspace.workspace_path,
	);
	writeWorkspaceFile(workspacePath, "good.txt", "checked-in\n");

	// A passing check job autosaves the working copy. Checks run from a PR's
	// Checks tab in the app; here the job runs through the API, and the
	// autosave it leaves behind is what this spec covers.
	await trustRepo(repoPath);
	const result = await runWorkflowJob(
		repoPath,
		"ci.yaml",
		"greet",
		workspace.id,
		workspacePath,
	);
	expect(result.success).toBe(true);

	await user.click(await screen.findByRole("tab", { name: /^Commits/ }));
	await screen.findByRole("tab", { name: /^Commits/, selected: true });
	notifyWorkspaceChanged(workspace.id);
	await screen.findByText(/treq-autosave: good\.txt/);

	await captureDocument(document, {
		name: "autosave-on-check-pass-02-autosave-in-log",
		expectations: [
			"The Commits tab is selected.",
			'The commit list shows a row whose message starts with "treq-autosave: good.txt".',
		],
	});

	writeWorkspaceFile(workspacePath, "good.txt", "shipped\n");
	await user.click(await screen.findByRole("tab", { name: /^Changes/ }));
	await screen.findByRole("tab", { name: /^Changes/, selected: true });
	notifyWorkspaceChanged(workspace.id);
	await screen.findByText("shipped");
	await user.type(
		await screen.findByPlaceholderText("Message"),
		"ship the good changes",
	);
	await user.click(screen.getByRole("button", { name: "Commit" }));
	await screen.findByText("Commit created");

	await user.click(await screen.findByRole("tab", { name: /^Commits/ }));
	await screen.findByRole("tab", { name: /^Commits/, selected: true });
	await waitFor(
		() => {
			expect(screen.getByText("ship the good changes")).toBeTruthy();
		},
		{ timeout: 15000 },
	);
	await waitFor(() => {
		expect(screen.queryByText(/treq-autosave: good\.txt/)).toBeNull();
	});

	await captureDocument(document, {
		name: "autosave-on-check-pass-03-after-manual-commit",
		expectations: [
			'The commit list shows "ship the good changes".',
			"No commit row shows treq-autosave in its message.",
		],
	});
}, 90000);
