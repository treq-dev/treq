import * as React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import {
	createTestRepo,
	findSidebarBranchElement,
	openRepo,
	writeRepoFile,
} from "../../utils";
import {
	createWorkspace,
	getWorkspaces,
	trustRepo,
} from "../../../src/lib/api";
import { render, screen, waitFor, within } from "../../test-utils";
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

let user: ReturnType<typeof userEvent.setup>;

async function openChecksTab(branchName: string) {
	render(<Dashboard />);
	await user.click(await findSidebarBranchElement(branchName));
	const checksTab = await screen.findByRole("tab", { name: /^Checks/ });
	await user.click(checksTab);
	await screen.findByRole("tab", { name: /^Checks/, selected: true });
}

describe("Checks tab", () => {
	beforeEach(() => {
		user = userEvent.setup();
	});

	it("shows empty state when no workflows exist", async () => {
		const { repoPath } = createTestRepo(false);
		openRepo(repoPath);
		const workspaceId = await createWorkspace(repoPath, "checks-empty");
		const workspaces = await getWorkspaces(repoPath);
		expect(workspaces.find((w) => w.id === workspaceId)).toBeDefined();

		await openChecksTab("checks-empty");

		await screen.findByText(/No workflows found/i);
	});

	it("lists workflow after adding YAML file", async () => {
		const { repoPath } = createTestRepo(false);
		openRepo(repoPath);
		await createWorkspace(repoPath, "checks-list");
		await writeRepoFile(repoPath, ".treq/workflows/ci.yaml", PASSING_WORKFLOW);

		await openChecksTab("checks-list");

		await screen.findByText("Passing CI");
	});

	it("shows step names within a job", async () => {
		const { repoPath } = createTestRepo(false);
		openRepo(repoPath);
		await createWorkspace(repoPath, "checks-steps");
		await writeRepoFile(repoPath, ".treq/workflows/ci.yaml", PASSING_WORKFLOW);

		await openChecksTab("checks-steps");

		await screen.findByText("Say hello");
		await screen.findByText("Say world");
	});

	it("shows green checkmarks after a passing job run", async () => {
		const { repoPath } = createTestRepo(false);
		openRepo(repoPath);
		await createWorkspace(repoPath, "checks-pass");
		await writeRepoFile(repoPath, ".treq/workflows/ci.yaml", PASSING_WORKFLOW);
		await trustRepo(repoPath);

		await openChecksTab("checks-pass");
		await screen.findByText("Greet Job");

		const runBtn = await screen.findByRole("button", {
			name: /Run Greet Job/i,
		});
		await user.click(runBtn);

		await waitFor(() => {
			const icons = document.querySelectorAll(
				'[data-testid="step-result-pass"]',
			);
			expect(icons.length).toBeGreaterThan(0);
		});
	});

	it("shows red X and stops after first failing step", async () => {
		const { repoPath } = createTestRepo(false);
		openRepo(repoPath);
		await createWorkspace(repoPath, "checks-fail");
		await writeRepoFile(repoPath, ".treq/workflows/ci.yaml", FAILING_WORKFLOW);
		await trustRepo(repoPath);

		await openChecksTab("checks-fail");
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
		const { repoPath } = createTestRepo(false);
		openRepo(repoPath);
		await createWorkspace(repoPath, "checks-sorted");
		await writeRepoFile(
			repoPath,
			".treq/workflows/z-last.yaml",
			PASSING_WORKFLOW,
		);
		await writeRepoFile(
			repoPath,
			".treq/workflows/a-first.yaml",
			FAILING_WORKFLOW,
		);

		await openChecksTab("checks-sorted");

		const workflowNames = await screen.findAllByText(/CI$/);
		expect(workflowNames[0].textContent).toBe("Failing CI");
		expect(workflowNames[1].textContent).toBe("Passing CI");
	});
});

const LOGGING_WORKFLOW = `
name: Logging CI
on:
  workflow_dispatch: {}
jobs:
  build:
    name: Build Job
    steps:
      - name: Emit output
        run: "echo hello-from-logs; echo 'warning: careful'; echo 'error: broke' 1>&2"
`;

describe("Checks logs browser", () => {
	beforeEach(() => {
		user = userEvent.setup();
	});

	async function runBuildJob(repoPath: string, branch: string) {
		await createWorkspace(repoPath, branch);
		await writeRepoFile(repoPath, ".treq/workflows/ci.yaml", LOGGING_WORKFLOW);
		await trustRepo(repoPath);
		await openChecksTab(branch);
		await user.click(
			await screen.findByRole("button", { name: /Run Build Job/i }),
		);
		await screen.findByTestId("run-history-item");
	}

	it("records a run in the history after running a job", async () => {
		const { repoPath } = createTestRepo(false);
		openRepo(repoPath);
		await runBuildJob(repoPath, "logs-history");

		const items = await screen.findAllByTestId("run-history-item");
		expect(items).toHaveLength(1);
	});

	it("adds a second history item when the job is re-run", async () => {
		const { repoPath } = createTestRepo(false);
		openRepo(repoPath);
		await runBuildJob(repoPath, "logs-rerun");

		await user.click(
			await screen.findByRole("button", { name: /Run Build Job/i }),
		);
		await waitFor(async () => {
			const items = await screen.findAllByTestId("run-history-item");
			expect(items).toHaveLength(2);
		});
	});

	it("opens the logs browser and shows captured output with levels", async () => {
		const { repoPath } = createTestRepo(false);
		openRepo(repoPath);
		await runBuildJob(repoPath, "logs-view");

		await user.click(
			(await screen.findAllByRole("button", { name: /^Logs/ }))[0],
		);

		await screen.findByTestId("logs-output");
		await screen.findByText("hello-from-logs");
		await waitFor(() => {
			const errorLines = document.querySelectorAll(
				'[data-testid="log-line"][data-level="error"]',
			);
			expect(errorLines.length).toBeGreaterThan(0);
		});
	});

	it("filters log lines by level", async () => {
		const { repoPath } = createTestRepo(false);
		openRepo(repoPath);
		await runBuildJob(repoPath, "logs-filter");

		await user.click(
			(await screen.findAllByRole("button", { name: /^Logs/ }))[0],
		);
		await screen.findByText("hello-from-logs");

		await user.click(await screen.findByTestId("log-level-filter"));
		await user.click(
			await screen.findByRole("menuitemcheckbox", { name: /error/i }),
		);

		await waitFor(() => {
			const lines = document.querySelectorAll('[data-testid="log-line"]');
			expect(lines.length).toBe(1);
		});
		expect(screen.queryByText("hello-from-logs")).toBeNull();
	});

	it("selects multiple levels at once in the filter", async () => {
		const { repoPath } = createTestRepo(false);
		openRepo(repoPath);
		await runBuildJob(repoPath, "logs-multi");

		await user.click(
			(await screen.findAllByRole("button", { name: /^Logs/ }))[0],
		);
		await screen.findByText("hello-from-logs");

		await user.click(await screen.findByTestId("log-level-filter"));
		await user.click(
			await screen.findByRole("menuitemcheckbox", { name: /warning/i }),
		);
		await user.click(
			await screen.findByRole("menuitemcheckbox", { name: /error/i }),
		);

		await waitFor(() => {
			const lines = document.querySelectorAll('[data-testid="log-line"]');
			expect(lines.length).toBe(2);
		});
		expect(screen.queryByText("hello-from-logs")).toBeNull();
	});

	it("exports logs to a file", async () => {
		const { repoPath } = createTestRepo(false);
		openRepo(repoPath);
		await runBuildJob(repoPath, "logs-export");

		await user.click(
			(await screen.findAllByRole("button", { name: /^Logs/ }))[0],
		);
		await screen.findByText("hello-from-logs");

		const browser = await screen.findByTestId("logs-browser");
		await user.click(
			await within(browser).findByRole("button", { name: /Export/i }),
		);

		const note = await screen.findByText(/Exported to/i);
		expect(note.textContent).toContain(".log");
	});
});
