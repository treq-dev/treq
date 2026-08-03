import * as React from "react";
import fs from "node:fs";
import path from "node:path";
import { expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import {
	commitWorkspaceFile,
	createTestRepo,
	openRepo,
} from "../../../test/utils";
import { render, screen, waitFor, within } from "../../../test/test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import { createWorkspace, getWorkspaces } from "../../../src/lib/api";
import { captureDocument } from "../capture";

const BRANCH_NAME = "feat/create-pr-dropdown";

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

vi.mock("../../../src/lib/api", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("../../../src/lib/api")>();
	return {
		...original,
		getPrInfoViaGh: vi.fn().mockResolvedValue(null),
		ghCreatePr: vi.fn().mockResolvedValue(42),
	};
});

it("captures Create PR dropdown without duplicate Push to remote", async () => {
	const { repoPath } = createTestRepo(true);
	openRepo(repoPath);
	await createWorkspace(repoPath, BRANCH_NAME);
	setOriginUrl(repoPath, "https://github.com/acme/treq.git");

	const workspace = (await getWorkspaces(repoPath)).find(
		(w) => w.branch_name === BRANCH_NAME,
	);
	if (!workspace) {
		throw new Error(`Expected ${BRANCH_NAME} workspace to exist`);
	}
	await commitWorkspaceFile(
		repoPath,
		{ id: workspace.id, path: workspace.workspace_path },
		"feature.txt",
		"feature content",
		"Add feature",
	);

	const user = userEvent.setup();
	render(<Dashboard />);

	await user.click(await screen.findByText(BRANCH_NAME));
	const header = await screen.findByTestId("show-workspace-header");
	await within(header).findByRole("button", { name: /^create pr$/i });

	await user.click(
		await within(header).findByRole("button", {
			name: /more create pr options/i,
		}),
	);
	await screen.findByRole("menuitem", { name: /create draft pr/i });
	expect(
		screen.queryByRole("menuitem", { name: /^push to remote$/i }),
	).not.toBeInTheDocument();

	await captureDocument(document, {
		name: "create-pr-dropdown-01-pr-menu",
		expectations: [
			"The Create PR chevron dropdown is open with 'Create draft PR' and 'Create PR manually' items.",
			"There is no 'Push to remote' item in the Create PR dropdown menu.",
			"The dark 'Create PR' button group is visible in the workspace header.",
		],
	});

	await user.keyboard("{Escape}");

	const overflowTrigger = within(header)
		.getAllByRole("button")
		.find((btn) => btn.className.includes("px-1") && btn.querySelector("svg"));
	if (!overflowTrigger) {
		throw new Error("Expected overflow menu trigger in header");
	}
	await user.click(overflowTrigger);
	await screen.findByRole("menuitem", { name: /^push to remote$/i });

	await captureDocument(document, {
		name: "create-pr-dropdown-02-overflow-menu",
		expectations: [
			"The header overflow menu is open and includes a 'Push to remote' item.",
			"'Push to remote' appears only in this overflow menu, not in the Create PR dropdown.",
			"The Create PR button group remains visible beside the overflow trigger.",
		],
	});
}, 60000);
