import * as React from "react";
import * as fs from "node:fs";
import * as path from "node:path";
import { expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import {
	createTestRepo,
	openRepo,
	resolveWorkspacePath,
} from "../../../test/utils";
import { render, screen, waitFor, within } from "../../../test/test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import { getWorkspaces } from "../../../src/lib/api";
import { captureDocument } from "../capture";

const BRANCH_NAME = "feat/symlink-qa";

it("captures symlink-from-home advanced option with gitignore suggestions", async () => {
	const { repoPath } = createTestRepo(false);
	openRepo(repoPath);

	const homeNodeModules = path.join(repoPath, "node_modules", "left-pad");
	fs.mkdirSync(homeNodeModules, { recursive: true });
	fs.writeFileSync(
		path.join(homeNodeModules, "index.js"),
		"module.exports = 1;\n",
	);
	const gitignore = path.join(repoPath, ".gitignore");
	const existing = fs.existsSync(gitignore)
		? fs.readFileSync(gitignore, "utf8")
		: "";
	if (!existing.includes("node_modules")) {
		fs.appendFileSync(gitignore, "\nnode_modules/\n");
	}

	const user = userEvent.setup();
	render(<Dashboard />);

	await screen.findByTestId("show-workspace-header");
	await user.click(await screen.findByRole("button", { name: "Stack" }));

	const dialog = await screen.findByTestId("modal");
	await within(dialog).findByRole("button", { name: "Advanced" });
	expect(
		within(dialog).queryByLabelText(
			/symlink from home repo \(optional, one per line\)/i,
		),
	).not.toBeInTheDocument();

	await captureDocument(document, {
		name: "workspace-symlink-dirs-01-advanced-collapsed",
		expectations: [
			"The workspace creation dialog is open.",
			'A collapsed "Advanced" toggle sits above Branch Name.',
			"No symlink textarea is visible yet.",
		],
	});

	await user.click(within(dialog).getByRole("button", { name: "Advanced" }));
	await within(dialog).findByLabelText(
		/symlink from home repo \(optional, one per line\)/i,
	);
	const suggestion = await within(dialog).findByRole("button", {
		name: "+ node_modules",
	});
	await user.click(suggestion);
	expect(
		within(dialog).getByLabelText(
			/symlink from home repo \(optional, one per line\)/i,
		),
	).toHaveValue("node_modules");

	await user.type(within(dialog).getByLabelText("Branch Name"), BRANCH_NAME);

	await captureDocument(document, {
		name: "workspace-symlink-dirs-02-suggestion-applied",
		expectations: [
			"Advanced is expanded with sparse paths and symlink fields.",
			"A + node_modules suggestion chip is visible.",
			"The symlink textarea contains node_modules.",
		],
	});

	await user.click(
		within(dialog).getByRole("button", { name: "Create Workspace" }),
	);
	await waitFor(() => {
		expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
	});

	const header = await screen.findByTestId("show-workspace-header");
	await within(header).findByText(BRANCH_NAME);

	const workspace = (await getWorkspaces(repoPath)).find(
		(candidate) => candidate.branch_name === BRANCH_NAME,
	);
	if (!workspace) {
		throw new Error(`Expected ${BRANCH_NAME} workspace to exist`);
	}

	const linkPath = path.join(
		resolveWorkspacePath(repoPath, workspace.workspace_path),
		"node_modules",
	);
	expect(fs.lstatSync(linkPath).isSymbolicLink()).toBe(true);

	await captureDocument(document, {
		name: "workspace-symlink-dirs-03-workspace-created",
		expectations: [
			"The workspace header shows feat/symlink-qa.",
			"node_modules appears in the workspace file browser.",
		],
	});
}, 60000);
