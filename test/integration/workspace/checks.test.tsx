import * as React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import {
	createTestRepo,
	findSidebarBranchElement,
	openRepo,
	writeRepoFile,
} from "../../utils";
import { createWorkspace, getWorkspaces } from "../../../src/lib/api";
import { render, screen, waitFor } from "../../test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import userEvent from "@testing-library/user-event";

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

const FAILING_WORKFLOW = `
name: Failing CI
on:
  workflow_dispatch: {}
jobs:
  check:
    name: Check Job
    steps:
      - name: Fail here
        run: exit 1
      - name: Never runs
        run: echo skipped
`;

async function openChecksTab(
	user: ReturnType<typeof userEvent.setup>,
	branchName: string,
) {
	render(<Dashboard />);
	await user.click(await findSidebarBranchElement(branchName));
	const checksTab = await screen.findByRole("tab", { name: /^Checks/ });
	await user.click(checksTab);
	await screen.findByRole("tab", { name: /^Checks/, selected: true });
}

describe("Checks tab", () => {
	it("shows empty state when no workflows exist", async () => {
		const user = userEvent.setup();
		const { repoPath } = createTestRepo(false);
		openRepo(repoPath);
		const workspaceId = await createWorkspace(repoPath, "checks-empty");
		const workspaces = await getWorkspaces(repoPath);
		expect(workspaces.find((w) => w.id === workspaceId)).toBeDefined();

		await openChecksTab(user, "checks-empty");

		await screen.findByText(/No workflows found/i);
	});

	it("lists workflow after adding YAML file", async () => {
		const user = userEvent.setup();
		const { repoPath } = createTestRepo(false);
		openRepo(repoPath);
		await createWorkspace(repoPath, "checks-list");
		await writeRepoFile(repoPath, ".treq/workflows/ci.yaml", PASSING_WORKFLOW);

		await openChecksTab(user, "checks-list");

		await screen.findByText("Passing CI");
	});

	it("shows step names within a job", async () => {
		const user = userEvent.setup();
		const { repoPath } = createTestRepo(false);
		openRepo(repoPath);
		await createWorkspace(repoPath, "checks-steps");
		await writeRepoFile(repoPath, ".treq/workflows/ci.yaml", PASSING_WORKFLOW);

		await openChecksTab(user, "checks-steps");

		await screen.findByText("Say hello");
		await screen.findByText("Say world");
	});

	it("shows green checkmarks after a passing job run", async () => {
		const user = userEvent.setup();
		const { repoPath } = createTestRepo(false);
		openRepo(repoPath);
		await createWorkspace(repoPath, "checks-pass");
		await writeRepoFile(repoPath, ".treq/workflows/ci.yaml", PASSING_WORKFLOW);

		await openChecksTab(user, "checks-pass");
		await screen.findByText("Greet Job");

		const runBtn = await screen.findByRole("button", {
			name: /Run Greet Job/i,
		});
		await user.click(runBtn);

		await waitFor(() => {
			const icons = document.querySelectorAll('[data-testid="step-result-pass"]');
			expect(icons.length).toBeGreaterThan(0);
		});
	});

	it("shows red X and stops after first failing step", async () => {
		const user = userEvent.setup();
		const { repoPath } = createTestRepo(false);
		openRepo(repoPath);
		await createWorkspace(repoPath, "checks-fail");
		await writeRepoFile(
			repoPath,
			".treq/workflows/ci.yaml",
			FAILING_WORKFLOW,
		);

		await openChecksTab(user, "checks-fail");
		await screen.findByText("Check Job");

		const runBtn = await screen.findByRole("button", {
			name: /Run Check Job/i,
		});
		await user.click(runBtn);

		await waitFor(() => {
			const failIcons = document.querySelectorAll(
				'[data-testid="step-result-fail"]',
			);
			expect(failIcons.length).toBe(1);
		});

		expect(
			document.querySelectorAll('[data-testid="step-result-pass"]').length,
		).toBe(0);
	});

	it("sorts multiple workflow files alphabetically", async () => {
		const user = userEvent.setup();
		const { repoPath } = createTestRepo(false);
		openRepo(repoPath);
		await createWorkspace(repoPath, "checks-sorted");
		await writeRepoFile(repoPath, ".treq/workflows/z-last.yaml", PASSING_WORKFLOW);
		await writeRepoFile(
			repoPath,
			".treq/workflows/a-first.yaml",
			FAILING_WORKFLOW,
		);

		await openChecksTab(user, "checks-sorted");

		const workflowNames = await screen.findAllByText(/CI$/);
		expect(workflowNames[0].textContent).toBe("Failing CI");
		expect(workflowNames[1].textContent).toBe("Passing CI");
	});
});
