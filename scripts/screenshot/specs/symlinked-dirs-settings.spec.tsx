import * as React from "react";
import * as fs from "node:fs";
import * as path from "node:path";
import { expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { createTestRepo, openRepo } from "../../../test/utils";
import { render, screen, waitFor, within } from "../../../test/test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import { getWorkspaces } from "../../../src/lib/api";
import { captureDocument } from "../capture";

const BRANCH_NAME = "feat/symlink-qa";

it("captures symlinked directories setting and workspace create with symlink", async () => {
	const { repoPath } = createTestRepo(false);
	openRepo(repoPath);

	// Heavy dir in the home repo that should be symlinked, not copied.
	const homeNodeModules = path.join(repoPath, "node_modules", "left-pad");
	fs.mkdirSync(homeNodeModules, { recursive: true });
	fs.writeFileSync(path.join(homeNodeModules, "index.js"), "module.exports = 1;\n");

	const user = userEvent.setup();
	render(<Dashboard />);

	await user.click(await screen.findByLabelText("Settings"));
	const repositoryTab = await screen.findByRole("tab", {
		name: /repository/i,
	});
	expect(repositoryTab).toHaveAttribute("data-state", "active");
	await screen.findByLabelText(/symlinked directories/i);

	await captureDocument(document, {
		name: "symlinked-dirs-settings-01-empty",
		expectations: [
			"The Repository settings tab is active.",
			"A Symlinked Directories textarea is visible below Included Files.",
			"Helper text mentions node_modules, target, or .venv.",
		],
	});

	const symlinkedDirs = await screen.findByLabelText(/symlinked directories/i);
	await user.clear(symlinkedDirs);
	await user.type(symlinkedDirs, "node_modules");
	await user.click(screen.getByRole("button", { name: /save settings/i }));
	await screen.findByText(
		/repository settings have been updated successfully/i,
	);

	await captureDocument(document, {
		name: "symlinked-dirs-settings-02-saved",
		expectations: [
			"The Symlinked Directories field shows node_modules.",
			"A success toast confirms repository settings were saved.",
		],
	});

	await user.click(screen.getByRole("button", { name: "Close" }));
	await waitFor(() => {
		expect(
			screen.queryByRole("heading", { name: "Settings" }),
		).not.toBeInTheDocument();
	});

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
		(candidate) => candidate.branch_name === BRANCH_NAME,
	);
	if (!workspace) {
		throw new Error(`Expected ${BRANCH_NAME} workspace to exist`);
	}

	const linkPath = path.join(
		repoPath,
		".treq",
		"workspaces",
		workspace.workspace_path,
		"node_modules",
	);
	expect(fs.lstatSync(linkPath).isSymbolicLink()).toBe(true);
	expect(fs.realpathSync(linkPath)).toBe(
		fs.realpathSync(path.join(repoPath, "node_modules")),
	);

	await captureDocument(document, {
		name: "symlinked-dirs-settings-03-workspace-created",
		expectations: [
			"The workspace header shows feat/symlink-qa after Stack create.",
			"Settings is closed; the main workspace view is visible.",
		],
	});
}, 60000);
