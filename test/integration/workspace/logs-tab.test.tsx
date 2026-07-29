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
			await screen.findByRole("button", { name: /Logs Explorer/i }),
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
			await screen.findByRole("button", { name: /Logs Explorer/i }),
		);
		await user.click(await screen.findByTestId("template-menu"));
		await user.click(
			await screen.findByRole("menuitem", { name: /Errors by job/i }),
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
			await screen.findByRole("button", { name: /Logs Explorer/i }),
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
	it("renders a timeseries chart above the feed", async () => {
		const { repoPath } = createTestRepo(false);
		openRepo(repoPath);
		await seedLogs(repoPath, "logs-chart");

		await openLogsTab();
		await screen.findByText("hello-from-logs");

		await screen.findByTestId("logs-timeseries-chart");
	});

	it("selects a range of lines by dragging and enables send to agent", async () => {
		const { repoPath } = createTestRepo(false);
		openRepo(repoPath);
		await seedLogs(repoPath, "logs-drag");

		await openLogsTab();
		await screen.findByText("hello-from-logs");

		const lines = await screen.findAllByTestId("repo-log-line");
		expect(screen.getByTestId("send-to-agent")).toBeDisabled();

		await user.pointer([
			{ target: lines[0], keys: "[MouseLeft>]" },
			{ target: lines[1] },
			{ keys: "[/MouseLeft]" },
		]);

		await waitFor(() => {
			expect(screen.getByTestId("selection-count").textContent).toMatch(/2 /);
		});
		expect(screen.getByTestId("send-to-agent")).toBeEnabled();
	});

	it("toggles individual lines in multi-select mode", async () => {
		const { repoPath } = createTestRepo(false);
		openRepo(repoPath);
		await seedLogs(repoPath, "logs-multi-pick");

		await openLogsTab();
		await screen.findByText("hello-from-logs");

		await user.click(await screen.findByTestId("multi-select-toggle"));
		const lines = await screen.findAllByTestId("repo-log-line");
		await user.click(lines[1]);

		await waitFor(() => {
			expect(screen.getByTestId("selection-count").textContent).toMatch(/1 /);
		});

		await user.click(lines[1]);
		await waitFor(() => {
			expect(screen.queryByTestId("selection-count")).toBeNull();
		});
	});

	it("offers sending the whole result set from the explorer", async () => {
		const { repoPath } = createTestRepo(false);
		openRepo(repoPath);
		await seedLogs(repoPath, "logs-send-results");

		await openLogsTab();
		await user.click(
			await screen.findByRole("button", { name: /Logs Explorer/i }),
		);

		expect(screen.queryByTestId("send-resultset-to-agent")).toBeNull();

		const explorer = await screen.findByTestId("logs-sql-explorer");
		await user.click(
			within(explorer).getByRole("button", { name: /Run query/i }),
		);
		await screen.findByTestId("sql-results");

		await screen.findByTestId("send-resultset-to-agent");
	});

	it("exposes OpenTelemetry columns in the logs view", async () => {
		const { repoPath } = createTestRepo(false);
		openRepo(repoPath);
		await seedLogs(repoPath, "logs-otel");

		await openLogsTab();
		await user.click(
			await screen.findByRole("button", { name: /Logs Explorer/i }),
		);

		const editor = await screen.findByTestId("sql-editor");
		await user.clear(editor);
		await user.type(
			editor,
			"SELECT severity_text, severity_number, body, trace_id, span_id, service_name FROM logs",
		);

		const explorer = await screen.findByTestId("logs-sql-explorer");
		await user.click(
			within(explorer).getByRole("button", { name: /Run query/i }),
		);

		const table = await screen.findByTestId("sql-results");
		await waitFor(() => {
			expect(within(table).getAllByText("ERROR").length).toBeGreaterThan(0);
			expect(within(table).getAllByText("treq").length).toBeGreaterThan(0);
		});
	});

	it("lists five query templates with descriptions", async () => {
		const { repoPath } = createTestRepo(false);
		openRepo(repoPath);
		await seedLogs(repoPath, "logs-templates");

		await openLogsTab();
		await user.click(
			await screen.findByRole("button", { name: /Logs Explorer/i }),
		);
		await user.click(await screen.findByTestId("template-menu"));

		const items = await screen.findAllByRole("menuitem");
		expect(items).toHaveLength(5);
		await screen.findByText("Newest records across every run");
	});
});
