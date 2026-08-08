import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { render, screen } from "./test-utils";
import { ArchivedWorkspacesModal } from "../src/components/ArchivedWorkspacesModal";

describe("ArchivedWorkspacesModal", () => {
	beforeEach(() => {
		vi.mocked(invoke).mockImplementation(async (command) => {
			if (command === "get_archived_workspaces") return [{
				id: 7, repo_path: "/repo", workspace_name: "feature", workspace_path: "feature",
				branch_name: "feat/archive", created_at: "2026-08-01T12:00:00Z",
				refreshed_at: "2026-08-08T10:00:00Z", target_branch: "main", title: "Archive UI",
				description: "Build the archive browser", not_on_remote: false, archived: true,
			}];
			if (command === "get_archived_workspace_commits") return [{
				short_id: "abc123", description: "Add archive modal", timestamp: "2026-08-08T09:00:00Z",
			}];
			return null;
		});
	});

	it("shows a selectable list with update time and workspace details in a right pane", async () => {
		render(<ArchivedWorkspacesModal open onOpenChange={vi.fn()} repoPath="/repo" />);

		expect((await screen.findAllByText("Archive UI")).length).toBeGreaterThan(0);
		expect(screen.getByText(/Updated/)).toBeInTheDocument();
		expect(screen.getByText("main")).toBeInTheDocument();
		expect(screen.getByText("Build the archive browser")).toBeInTheDocument();
		expect(await screen.findByText("Add archive modal")).toBeInTheDocument();
	});
});
