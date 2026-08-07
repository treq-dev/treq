import { ask } from "@tauri-apps/plugin-dialog";
import userEvent from "@testing-library/user-event";
import { within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "../../test/test-utils";
import { createMockCommit } from "../../test/factories/commit.factory";
import * as api from "../lib/api";
import { CommitDiffViewer } from "./CommitDiffViewer";

vi.mock("../lib/api", async () => {
	const actual = await vi.importActual("../lib/api");
	return {
		...actual,
		abandonCommit: vi.fn(),
		undoCommit: vi.fn(),
		revertCommit: vi.fn(),
		listCommits: vi.fn(),
		getCommitDiff: vi.fn(),
	};
});

const latestCommit = createMockCommit({
	commit_id: "latest001",
	short_id: "latest01",
	change_id: "chg_latest",
	description: "Latest commit",
	timestamp: "2024-01-15 10:00:00",
	is_immutable: false,
});

const olderCommit = createMockCommit({
	commit_id: "older001",
	short_id: "older01",
	change_id: "chg_older",
	description: "Older commit",
	timestamp: "2024-01-14 10:00:00",
	is_immutable: false,
});

const targetOnlyCommit = createMockCommit({
	commit_id: "target001",
	short_id: "target01",
	change_id: "chg_target",
	description: "Target branch commit",
	timestamp: "2024-01-13 10:00:00",
	is_immutable: true,
	on_target_only: true,
});

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(api.getCommitDiff).mockResolvedValue({
		committed_files: [],
		hunks_by_file: [],
		too_large_to_render: false,
		render_block_reason: null,
	});
});

async function expandCommit(description: string) {
	const user = userEvent.setup();
	await user.click(await screen.findByText(description));
	return user;
}

function rowFor(commitId: string): HTMLElement {
	const el = document.querySelector(`[data-commit-id="${commitId}"]`);
	if (!el) throw new Error(`No row found for commit ${commitId}`);
	return el as HTMLElement;
}

describe("CommitDiffViewer - Undo/Revert commit", () => {
	it("shows Undo commit only on the latest workspace-lineage commit", async () => {
		vi.mocked(api.listCommits).mockResolvedValue({
			commits: [latestCommit, olderCommit],
			target_branch: "main",
			workspace_branch: "feat/test",
		});

		render(<CommitDiffViewer repoPath="/test/repo" workspaceId={1} />);

		await waitFor(() => {
			expect(screen.getByText("Latest commit")).toBeInTheDocument();
		});

		await expandCommit("Latest commit");
		expect(
			await within(rowFor("latest001")).findByRole("button", {
				name: /undo commit/i,
			}),
		).toBeInTheDocument();

		await expandCommit("Older commit");
		expect(
			within(rowFor("older001")).queryByRole("button", {
				name: /undo commit/i,
			}),
		).not.toBeInTheDocument();
	});

	it("shows Revert commit on every real commit, including target-branch-only ones, but not on the tentative working copy", async () => {
		const tentativeCommit = createMockCommit({
			commit_id: "wc-tentative",
			short_id: "wc-tenta",
			description: "(no description)",
			is_working_copy: true,
			timestamp: "2024-01-16 10:00:00",
		});

		vi.mocked(api.listCommits).mockResolvedValue({
			commits: [latestCommit, targetOnlyCommit],
			tentative_working_copy: {
				workspace_label: "feat/test",
				commit: tentativeCommit,
			},
			target_branch: "main",
			workspace_branch: "feat/test",
		});

		render(<CommitDiffViewer repoPath="/test/repo" workspaceId={1} />);

		await waitFor(() => {
			expect(screen.getByText("Latest commit")).toBeInTheDocument();
		});

		await expandCommit("Latest commit");
		expect(
			await within(rowFor("latest001")).findByRole("button", {
				name: /revert commit/i,
			}),
		).toBeInTheDocument();

		await expandCommit("Target branch commit");
		expect(
			await within(rowFor("target001")).findByRole("button", {
				name: /revert commit/i,
			}),
		).toBeInTheDocument();

		await expandCommit("Working copy");
		expect(
			within(rowFor("wc-tentative")).queryByRole("button", {
				name: /revert commit/i,
			}),
		).not.toBeInTheDocument();
	});

	it("undoes the latest commit after confirming", async () => {
		vi.mocked(ask).mockResolvedValue(true);
		vi.mocked(api.listCommits).mockResolvedValue({
			commits: [latestCommit, olderCommit],
			target_branch: "main",
			workspace_branch: "feat/test",
		});
		vi.mocked(api.undoCommit).mockResolvedValue(undefined);

		render(<CommitDiffViewer repoPath="/test/repo" workspaceId={1} />);

		await waitFor(() => {
			expect(screen.getByText("Latest commit")).toBeInTheDocument();
		});

		const user = await expandCommit("Latest commit");
		await user.click(
			await screen.findByRole("button", { name: /undo commit/i }),
		);

		await waitFor(() => {
			expect(api.undoCommit).toHaveBeenCalledWith(
				"/test/repo",
				1,
				"chg_latest",
			);
		});
	});

	it("reverts a commit after confirming", async () => {
		vi.mocked(ask).mockResolvedValue(true);
		vi.mocked(api.listCommits).mockResolvedValue({
			commits: [latestCommit, olderCommit],
			target_branch: "main",
			workspace_branch: "feat/test",
		});
		vi.mocked(api.revertCommit).mockResolvedValue(undefined);

		render(<CommitDiffViewer repoPath="/test/repo" workspaceId={1} />);

		await waitFor(() => {
			expect(screen.getByText("Older commit")).toBeInTheDocument();
		});

		const user = await expandCommit("Older commit");
		await user.click(
			await screen.findByRole("button", { name: /revert commit/i }),
		);

		await waitFor(() => {
			expect(api.revertCommit).toHaveBeenCalledWith(
				"/test/repo",
				1,
				"chg_older",
			);
		});
	});

	it("does not undo or revert when the user cancels the confirmation", async () => {
		vi.mocked(ask).mockResolvedValue(false);
		vi.mocked(api.listCommits).mockResolvedValue({
			commits: [latestCommit, olderCommit],
			target_branch: "main",
			workspace_branch: "feat/test",
		});

		render(<CommitDiffViewer repoPath="/test/repo" workspaceId={1} />);

		await waitFor(() => {
			expect(screen.getByText("Latest commit")).toBeInTheDocument();
		});

		const user = await expandCommit("Latest commit");
		await user.click(
			await screen.findByRole("button", { name: /undo commit/i }),
		);
		await user.click(
			await screen.findByRole("button", { name: /revert commit/i }),
		);

		expect(api.undoCommit).not.toHaveBeenCalled();
		expect(api.revertCommit).not.toHaveBeenCalled();
	});
});
