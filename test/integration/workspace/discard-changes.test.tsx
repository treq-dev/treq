import * as React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "../../test-utils";
import {
	createTestRepo,
	findSidebarBranchElement,
	openRepo,
	resolveWorkspacePath,
	writeWorkspaceFile,
} from "../../utils";
import * as api from "../../../src/lib/api";
import { Dashboard } from "../../../src/components/Dashboard";
import fs from "node:fs";
import path from "node:path";

async function createDirtyWorkspace(branchName: string, fileName: string) {
	const { repoPath } = createTestRepo(false);
	openRepo(repoPath);

	const workspaceId = await api.createWorkspace(repoPath, branchName);
	const workspace = (await api.getWorkspaces(repoPath)).find(
		(candidate) => candidate.id === workspaceId,
	);
	expect(workspace).toBeTruthy();

	const workspacePath = resolveWorkspacePath(
		repoPath,
		workspace!.workspace_path,
	);
	writeWorkspaceFile(workspacePath, fileName, "dirty working copy content\n");

	return { repoPath, workspace: workspace!, workspacePath };
}

async function openReviewTab(
	user: ReturnType<typeof userEvent.setup>,
	branchName: string,
) {
	render(<Dashboard />);
	await user.click(await findSidebarBranchElement(branchName));
	const reviewTab = await screen.findByRole("tab", { name: /^Review/ });
	await user.click(reviewTab);
	await screen.findByRole("tab", { name: /^Review/, selected: true });
}

describe("Review tab - discard changes", () => {
	let user: ReturnType<typeof userEvent.setup>;

	beforeEach(() => {
		user = userEvent.setup();
	});

	it("discards all uncommitted changes from the Review tab", async () => {
		const fileName = "discard-all.txt";
		const { workspacePath } = await createDirtyWorkspace(
			"feat/discard-all",
			fileName,
		);
		await openReviewTab(user, "feat/discard-all");

		await waitFor(() =>
			expect(screen.getAllByText(fileName).length).toBeGreaterThan(0),
		);

		// Opens the confirmation dialog
		await user.click(
			await screen.findByRole("button", { name: /discard all changes/i }),
		);
		await screen.findByText("Discard all changes?");
		// Confirm in the dialog (last matching button is the destructive action)
		const confirmButtons = screen.getAllByRole("button", {
			name: /discard all changes/i,
		});
		await user.click(confirmButtons[confirmButtons.length - 1]);

		await waitFor(() => {
			expect(screen.queryAllByText(fileName)).toHaveLength(0);
		});

		expect(fs.existsSync(path.join(workspacePath, fileName))).toBe(false);
	});

	it("discards a selected file from the Review sidebar", async () => {
		const fileName = "discard-one.txt";
		const { workspacePath } = await createDirtyWorkspace(
			"feat/discard-one",
			fileName,
		);
		await openReviewTab(user, "feat/discard-one");

		await waitFor(() =>
			expect(screen.getAllByText(fileName).length).toBeGreaterThan(0),
		);

		// Sidebar file row — first match is in the Changes list
		await user.click(screen.getAllByText(fileName)[0]);

		await user.click(await screen.findByTitle("Discard selected files"));

		await waitFor(() => {
			expect(screen.queryAllByText(fileName)).toHaveLength(0);
		});

		expect(fs.existsSync(path.join(workspacePath, fileName))).toBe(false);
	});
});
