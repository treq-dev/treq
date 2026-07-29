import * as React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import {
	createTestRepo,
	findSidebarBranchElement,
	openRepo,
	writeRepoFile,
} from "../../utils";
import { createWorkspace, trustRepo } from "../../../src/lib/api";
import { render, screen, waitFor, within } from "../../test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import userEvent from "@testing-library/user-event";

const LOGGING_WORKFLOW = `
name: Logging CI
on:
  workflow_dispatch: {}
jobs:
  build:
    name: Build Job
    steps:
      - name: Emit output
        run: "echo hello-from-logs; echo 'error: broke' 1>&2"
`;

let user: ReturnType<typeof userEvent.setup>;

async function openLogsTab() {
	render(<Dashboard />);
	const logsTab = await screen.findByRole("tab", { name: /^Logs/ });
	await user.click(logsTab);
	await screen.findByRole("tab", { name: /^Logs/, selected: true });
}

async function seedLogs(repoPath: string, branch: string) {
	await createWorkspace(repoPath, branch);
	await writeRepoFile(repoPath, ".treq/workflows/ci.yaml", LOGGING_WORKFLOW);
	await trustRepo(repoPath);

	render(<Dashboard />);
	await user.click(await findSidebarBranchElement(branch));
	await user.click(await screen.findByRole("tab", { name: /^Checks/ }));
	await user.click(
		await screen.findByRole("button", { name: /Run Build Job/i }),
	);
	await screen.findByTestId("run-history-item");
}

describe("Home repo Logs tab", () => {
	beforeEach(() => {
		user = userEvent.setup();
	});

	it("shows an empty state when no checks have run", async () => {
		const { repoPath } = createTestRepo(false);
		openRepo(repoPath);

		await openLogsTab();

		await screen.findByText(/No check logs recorded yet/i);
	});

	it("is not offered inside a workspace", async () => {
		const { repoPath } = createTestRepo(false);
		openRepo(repoPath);
		await createWorkspace(repoPath, "logs-scope");

		render(<Dashboard />);
		await user.click(await findSidebarBranchElement("logs-scope"));
		await screen.findByRole("tab", { name: /^Checks/ });

		expect(screen.queryByRole("tab", { name: /^Logs/ })).toBeNull();
	});

	it("browses log lines across runs with run and job ids", async () => {
		const { repoPath } = createTestRepo(false);
		openRepo(repoPath);
		await seedLogs(repoPath, "logs-browse");

		await openLogsTab();

		await screen.findByText("hello-from-logs");
		const lines = document.querySelectorAll('[data-testid="repo-log-line"]');
		expect(lines.length).toBe(2);
	});

	it("filters the repo-wide logs by level", async () => {
		const { repoPath } = createTestRepo(false);
		openRepo(repoPath);
		await seedLogs(repoPath, "logs-level");

		await openLogsTab();
		await screen.findByText("hello-from-logs");

		await user.click(await screen.findByTestId("log-level-filter"));
		await user.click(
			await screen.findByRole("menuitemcheckbox", { name: /error/i }),
		);

		await waitFor(() => {
			const lines = document.querySelectorAll('[data-testid="repo-log-line"]');
			expect(lines.length).toBe(1);
		});
	});

	it("runs a SQL query in the explorer and renders a result grid", async () => {
		const { repoPath } = createTestRepo(false);
		openRepo(repoPath);
		await seedLogs(repoPath, "logs-sql");

		await openLogsTab();
		await user.click(
			await screen.findByRole("button", { name: /SQL Explorer/i }),
		);

		const explorer = await screen.findByTestId("logs-sql-explorer");
		await user.click(
			within(explorer).getByRole("button", { name: /Run query/i }),
		);

		const table = await screen.findByTestId("sql-results");
		expect(within(table).getAllByRole("row").length).toBeGreaterThan(1);
	});

	it("aggregates across runs with a GROUP BY query", async () => {
		const { repoPath } = createTestRepo(false);
		openRepo(repoPath);
		await seedLogs(repoPath, "logs-agg");

		await openLogsTab();
		await user.click(
			await screen.findByRole("button", { name: /SQL Explorer/i }),
		);
		await user.click(
			await screen.findByRole("button", { name: /Errors by job/i }),
		);

		const explorer = await screen.findByTestId("logs-sql-explorer");
		await user.click(
			within(explorer).getByRole("button", { name: /Run query/i }),
		);

		const table = await screen.findByTestId("sql-results");
		await within(table).findByText("build");
	});

	it("rejects a non-read-only query with an error", async () => {
		const { repoPath } = createTestRepo(false);
		openRepo(repoPath);
		await seedLogs(repoPath, "logs-readonly");

		await openLogsTab();
		await user.click(
			await screen.findByRole("button", { name: /SQL Explorer/i }),
		);

		const editor = await screen.findByTestId("sql-editor");
		await user.clear(editor);
		await user.type(editor, "DROP TABLE logs");

		const explorer = await screen.findByTestId("logs-sql-explorer");
		await user.click(
			within(explorer).getByRole("button", { name: /Run query/i }),
		);

		const error = await screen.findByTestId("sql-error");
		expect(error.textContent).toMatch(/read-only/i);
	});
});
