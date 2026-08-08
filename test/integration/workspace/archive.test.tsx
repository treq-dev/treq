import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "../../test-utils";
import userEvent from "@testing-library/user-event";
import { ask } from "@tauri-apps/plugin-dialog";
import {
	createTestRepo,
	findSidebarBranchElement,
	openRepo,
} from "../../utils";
import { createWorkspace } from "../../../src/lib/api";
import { Dashboard } from "../../../src/components/Dashboard";

describe("workspace archiving", () => {
	let repoPath: string;
	let user: ReturnType<typeof userEvent.setup>;

	beforeEach(async () => {
		({ repoPath } = createTestRepo(false));
		openRepo(repoPath);
		user = userEvent.setup();
		vi.mocked(ask).mockResolvedValue(true);
	});

	it("archives a workspace from the context menu and restores it from the Archived Workspaces modal", async () => {
		await createWorkspace(repoPath, "feat/archive-me");

		render(<Dashboard />);

		const branchElement = await findSidebarBranchElement("feat/archive-me");
		fireEvent.contextMenu(branchElement);
		await user.click(await screen.findByText("Archive Workspace"));

		await waitFor(() => {
			expect(screen.queryByText("feat/archive-me")).not.toBeInTheDocument();
		});

		await user.keyboard("{Control>}k{/Control}");
		await user.click(await screen.findByText("Archived Workspaces"));

		await screen.findByText("feat/archive-me");
		await user.click(await screen.findByRole("button", { name: "Restore" }));

		await waitFor(() => {
			expect(
				screen.queryByRole("button", { name: "Restore" }),
			).not.toBeInTheDocument();
		});
		await user.click(await screen.findByRole("button", { name: "Close" }));

		await findSidebarBranchElement("feat/archive-me");
	}, 30000);

	it("shows an empty state when there are no archived workspaces", async () => {
		render(<Dashboard />);

		await user.keyboard("{Control>}k{/Control}");
		await user.click(await screen.findByText("Archived Workspaces"));

		await screen.findByText("No archived workspaces");
	});

	it("bulk-archives multiple selected workspaces from the sidebar", async () => {
		await createWorkspace(repoPath, "feat/bulk-a");
		await createWorkspace(repoPath, "feat/bulk-b");

		render(<Dashboard />);

		const a = await findSidebarBranchElement("feat/bulk-a");
		const b = await findSidebarBranchElement("feat/bulk-b");

		await user.keyboard("{Meta>}");
		await user.click(a);
		await user.click(b);
		await user.keyboard("{/Meta}");

		expect(screen.queryByText(/Delete 2/)).not.toBeInTheDocument();

		await user.click(await screen.findByText(/Archive 2/));

		await waitFor(() => {
			expect(screen.queryByText("feat/bulk-a")).not.toBeInTheDocument();
			expect(screen.queryByText("feat/bulk-b")).not.toBeInTheDocument();
		});
	}, 30000);
});
