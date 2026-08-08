import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "../../test/test-utils";
import userEvent from "@testing-library/user-event";
import { ShowWorkspace } from "./ShowWorkspace";
import type { JjLogCommit, JjLogResult, Workspace } from "../lib/api";

vi.mock("./FileBrowser", () => ({
	FileBrowser: () => <div data-testid="file-browser" />,
}));

vi.mock("./LinearCommitHistory", () => ({
	LinearCommitHistory: () => <div data-testid="linear-commit-history" />,
}));

vi.mock("./ChangesDiffViewer", () => ({
	ChangesDiffViewer: ({
		showCommittedChanges,
	}: {
		showCommittedChanges: boolean;
	}) => (
		<div
			data-testid="changes-viewer"
			data-show-committed={String(showCommittedChanges)}
		/>
	),
}));

vi.mock("./TargetBranchSelector", () => ({
	TargetBranchSelector: () => <div data-testid="target-branch-selector" />,
}));

vi.mock("../lib/api", async () => {
	const actual =
		await vi.importActual<typeof import("../lib/api")>("../lib/api");
	return {
		...actual,
		getSetting: vi.fn().mockResolvedValue(null),
		getRepoSetting: vi.fn().mockResolvedValue(null),
		lsWorkspace: vi.fn().mockResolvedValue([]),
		getWorkspaceReadme: vi.fn().mockResolvedValue(null),
		jjGetDefaultBranch: vi.fn().mockResolvedValue("main"),
		listConflictedFiles: vi.fn().mockResolvedValue([]),
		jjGetBranches: vi.fn().mockResolvedValue([]),
		setWorkspaceTargetBranch: vi.fn().mockResolvedValue(undefined),
		jjGetChangedFiles: vi.fn().mockResolvedValue([]),
		createSession: vi.fn().mockResolvedValue(42),
		ptyCreateSession: vi.fn().mockResolvedValue(undefined),
		ptyWrite: vi.fn().mockResolvedValue(undefined),
		checkAndRebaseWorkspaces: vi.fn().mockResolvedValue({
			rebased: false,
			success: true,
			has_conflicts: false,
			conflicted_files: [],
			message: "No rebase needed",
			bookmark_conflicts: [],
		}),
		resolveBookmarkConflict: vi.fn().mockResolvedValue({
			success: true,
			message: "Resolved",
		}),
		listCommits: vi.fn(),
	};
});

const workingCopyCommit: JjLogCommit = {
	commit_id: "abc123",
	short_id: "abc",
	change_id: "chg123",
	description: "(no description)",
	author_name: "Test User",
	timestamp: new Date().toISOString(),
	parent_ids: [],
	is_working_copy: true,
	bookmarks: [],
	is_immutable: false,
	insertions: 0,
	deletions: 0,
	on_target_only: false,
};

const realWorkspaceCommit: JjLogCommit = {
	commit_id: "def456",
	short_id: "def",
	change_id: "chg456",
	description: "Add feature",
	author_name: "Test User",
	timestamp: new Date().toISOString(),
	parent_ids: [],
	is_working_copy: false,
	bookmarks: [],
	is_immutable: false,
	insertions: 5,
	deletions: 2,
	on_target_only: false,
};

function makeLogResult(commits: JjLogCommit[]): JjLogResult {
	return {
		commits,
		target_branch: "main",
		workspace_branch: "feature-one",
	};
}

const workspace: Workspace = {
	id: 7,
	repo_path: "/Users/test/repo",
	workspace_name: "feature-one",
	workspace_path: "/Users/test/repo/.treq/workspaces/feature-one",
	branch_name: "feature-one",
	title: "feature-one",
	created_at: new Date().toISOString(),
	not_on_remote: false,
	archived: false,
};

function renderWorkspace() {
	return render(
		<ShowWorkspace
			repositoryPath={workspace.repo_path}
			workspace={workspace}
			mainRepoBranch="main"
			initialSelectedFile={null}
			onDeleteWorkspace={vi.fn()}
		/>,
	);
}

const defaultBranchWorkspace: Workspace = {
	...workspace,
	id: 9,
	workspace_name: "main",
	branch_name: "main",
};

function renderDefaultBranchWorkspace() {
	return render(
		<ShowWorkspace
			repositoryPath={defaultBranchWorkspace.repo_path}
			workspace={defaultBranchWorkspace}
			mainRepoBranch="main"
			initialSelectedFile={null}
			onDeleteWorkspace={vi.fn()}
		/>,
	);
}

describe("Committed toggle on default branch", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("passes showCommittedChanges=false to ChangesDiffViewer for a default-branch workspace", async () => {
		const { listCommits } = await import("../lib/api");
		vi.mocked(listCommits).mockResolvedValue(
			makeLogResult([workingCopyCommit, realWorkspaceCommit]),
		);

		renderDefaultBranchWorkspace();

		const user = userEvent.setup();
		const changesTab = await screen.findByRole("tab", { name: /review/i });
		await user.click(changesTab);

		const viewer = await screen.findByTestId("changes-viewer");
		await waitFor(() => {
			expect(viewer.dataset.showCommitted).toBe("false");
		});
	});

	it("does not render the Committed toggle for a default-branch workspace", async () => {
		const { listCommits } = await import("../lib/api");
		// Even with real commits present, the toggle must not appear on the default branch.
		vi.mocked(listCommits).mockResolvedValue(
			makeLogResult([workingCopyCommit, realWorkspaceCommit]),
		);

		renderDefaultBranchWorkspace();

		const user = userEvent.setup();
		const changesTab = await screen.findByRole("tab", { name: /review/i });
		await user.click(changesTab);

		// Tab content has rendered (changes viewer present) but no Committed toggle.
		await screen.findByTestId("changes-viewer");
		expect(
			screen.queryByRole("button", { name: /committed/i }),
		).not.toBeInTheDocument();
	});
});

describe("Committed toggle disabled state", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("disables the Committed toggle when workspace has no own commits", async () => {
		const { listCommits } = await import("../lib/api");
		vi.mocked(listCommits).mockResolvedValue(
			makeLogResult([workingCopyCommit]),
		);

		renderWorkspace();

		const user = userEvent.setup();
		const changesTab = await screen.findByRole("tab", { name: /review/i });
		await user.click(changesTab);

		const committedBtn = await screen.findByRole("button", {
			name: /committed/i,
		});
		await waitFor(() => expect(committedBtn).toBeDisabled());
	});

	it("enables the Committed toggle when workspace has real commits", async () => {
		const { listCommits } = await import("../lib/api");
		vi.mocked(listCommits).mockResolvedValue(
			makeLogResult([workingCopyCommit, realWorkspaceCommit]),
		);

		renderWorkspace();

		const user = userEvent.setup();
		const changesTab = await screen.findByRole("tab", { name: /review/i });
		await user.click(changesTab);

		const committedBtn = await screen.findByRole("button", {
			name: /committed/i,
		});
		await waitFor(() => expect(committedBtn).toBeEnabled());
	});
});
