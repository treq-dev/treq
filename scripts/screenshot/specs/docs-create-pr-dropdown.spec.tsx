import fs from "node:fs";
import path from "node:path";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { expect, it, vi } from "vitest";
import { Dashboard } from "../../../src/components/Dashboard";
import { getWorkspaces } from "../../../src/lib/api";
import { render, screen, waitFor, within } from "../../../test/test-utils";
import {
	createTestRepo,
	notifyWorkspaceChanged,
	openRepo,
	resolveWorkspacePath,
	writeWorkspaceFile,
} from "../../../test/utils";
import { captureDocument } from "../capture";

const BRANCH_NAME = "feat/create-pr-dropdown-docs";

vi.mock("../../../src/lib/api", async () => {
	const actual = await vi.importActual<typeof import("../../../src/lib/api")>(
		"../../../src/lib/api",
	);
	return {
		...actual,
		getCachedPrInfo: vi.fn().mockResolvedValue(null),
		startPrStatusPolling: vi.fn(async () => undefined),
		refreshPrBranchStatus: vi.fn(async () => undefined),
		stopPrStatusPolling: vi.fn(async () => undefined),
		refreshPrStatuses: vi.fn(async () => undefined),
	};
});

function setOriginUrl(repoPath: string, remoteUrl: string) {
	const configPath = path.join(repoPath, ".git", "config");
	let config = fs.readFileSync(configPath, "utf-8");
	if (/\[remote "origin"\][\s\S]*?url\s*=/.test(config)) {
		config = config.replace(
			/(\[remote "origin"\][\s\S]*?url\s*=\s*).*/m,
			`$1${remoteUrl}`,
		);
	} else {
		config += `\n[remote "origin"]\n\turl = ${remoteUrl}\n`;
	}
	fs.writeFileSync(configPath, config);
}

it("captures Create PR dropdown open for docs", async () => {
	const { repoPath } = createTestRepo(true);
	openRepo(repoPath);
	setOriginUrl(repoPath, "https://github.com/acme/treq.git");

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

	const header = await screen.findByTestId("show-workspace-header");
	await within(header).findByText(BRANCH_NAME);

	const workspace = (await getWorkspaces(repoPath)).find(
		(w) => w.branch_name === BRANCH_NAME,
	)!;
	writeWorkspaceFile(
		resolveWorkspacePath(repoPath, workspace.workspace_path),
		"feature.txt",
		"feature content\n",
	);
	await user.click(await screen.findByRole("tab", { name: /^Changes/ }));
	notifyWorkspaceChanged(workspace.id);
	await screen.findByRole("tab", { name: /^Changes/, selected: true });
	await user.type(await screen.findByPlaceholderText("Message"), "Add feature");
	await user.click(await screen.findByRole("button", { name: /^commit\b/i }));
	await user.click(await screen.findByRole("tab", { name: /^Code/ }));

	const createPrButton = await within(header).findByRole("button", {
		name: /^create pr$/i,
	});
	await waitFor(() => expect(createPrButton).toBeEnabled());

	await user.click(
		await within(header).findByRole("button", {
			name: /more create pr options/i,
		}),
	);
	await screen.findByText("Create draft PR");
	await screen.findByText("Create PR manually");

	await captureDocument(document, {
		name: "docs-create-pr-dropdown-01-open",
		expectations: [
			"The Create PR split button is visible in the workspace header with its dropdown open.",
			"The dropdown lists 'Create draft PR' and 'Create PR manually'.",
		],
	});
}, 60000);
