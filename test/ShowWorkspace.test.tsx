import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "./test-utils";
import userEvent from "@testing-library/user-event";
import { act } from "@testing-library/react";
import { ShowWorkspace } from "../src/components/ShowWorkspace";
import * as api from "../src/lib/api";
import type { Workspace } from "../src/lib/api";

// Capture onCreateAgentWithComment handler from the FileBrowser mock
let fileBrowserCommentHandler:
	| ((
			filePath: string,
			startLine: number,
			endLine: number,
			lines: string[],
			comment: string,
	  ) => Promise<void> | void)
	| null = null;

// Capture onCreateAgentWithReview handler from the ChangesDiffViewer mock
let changesDiffReviewHandler:
	| ((reviewMarkdown: string) => Promise<void>)
	| null = null;

vi.mock("../src/components/FileBrowser", () => ({
	FileBrowser: (props: {
		onCreateAgentWithComment?: typeof fileBrowserCommentHandler;
	}) => {
		fileBrowserCommentHandler = props.onCreateAgentWithComment || null;
		return <div data-testid="file-browser" />;
	},
}));

vi.mock("../src/components/LinearCommitHistory", () => ({
	LinearCommitHistory: () => <div data-testid="linear-commit-history" />,
}));

vi.mock("../src/components/ChangesDiffViewer", () => ({
	ChangesDiffViewer: (props: {
		onCreateAgentWithReview?: typeof changesDiffReviewHandler;
	}) => {
		changesDiffReviewHandler = props.onCreateAgentWithReview || null;
		return <div data-testid="changes-viewer" />;
	},
}));

// Capture onSelect handler from the TargetBranchSelector mock
let targetBranchSelectHandler: ((branch: string) => void) | null = null;

vi.mock("../src/components/TargetBranchSelector", () => ({
	TargetBranchSelector: (props: { onSelect?: (branch: string) => void }) => {
		targetBranchSelectHandler = props.onSelect || null;
		return <div data-testid="target-branch-selector" />;
	},
}));

vi.mock("../src/lib/api", async () => {
	const actual =
		await vi.importActual<typeof import("../src/lib/api")>("../src/lib/api");
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
			preserved_change_ids: ["xyz987"],
		}),
	};
});

const workspace: Workspace = {
	id: 7,
	repo_path: "/Users/test/repo",
	workspace_name: "feature-one",
	workspace_path: "/Users/test/repo/.treq/workspaces/feature-one",
	branch_name: "feature-one",
	created_at: new Date().toISOString(),
	not_on_remote: false,
	archived: false,
};

describe("ShowWorkspace agent comments", () => {
	beforeEach(() => {
		fileBrowserCommentHandler = null;
		changesDiffReviewHandler = null;
		vi.clearAllMocks();
	});

	it("notifies parent when submitting a file comment", async () => {
		const onSessionCreated = vi.fn();

		render(
			<ShowWorkspace
				repositoryPath={workspace.repo_path}
				workspace={workspace}
				mainRepoBranch="main"
				initialSelectedFile={null}
				onDeleteWorkspace={vi.fn()}
				allWorkspaces={[workspace]}
				{...({ onSessionCreated } as Record<string, unknown>)}
			/>,
		);

		const user = userEvent.setup();
		const filesTab = await screen.findByRole("tab", { name: /files/i });
		await user.click(filesTab);

		await waitFor(() => expect(fileBrowserCommentHandler).toBeTruthy());

		await act(async () => {
			await fileBrowserCommentHandler?.(
				`${workspace.workspace_path}/src/components/App.tsx`,
				10,
				12,
				["line 1", "line 2", "line 3"],
				"Please update these lines",
			);
		});

		expect(api.createSession).toHaveBeenCalledWith(
			workspace.repo_path,
			workspace.id,
			"Code Comment",
		);

		// PTY session should NOT be created by the handler - ConsolidatedTerminal will create it
		expect(api.ptyCreateSession).not.toHaveBeenCalled();

		// Verify pending prompt is passed through onSessionCreated
		const expectedComment =
			"src/components/App.tsx:10-12\n```\nline 1\nline 2\nline 3\n```\n> Please update these lines\n";

		expect(onSessionCreated).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: 42,
				workspacePath: workspace.workspace_path,
				pendingPrompt: expectedComment,
			}),
		);
	});

	it("creates agent session with pre-filled review when submitting code review", async () => {
		const onSessionCreated = vi.fn();

		render(
			<ShowWorkspace
				repositoryPath={workspace.repo_path}
				workspace={workspace}
				mainRepoBranch="main"
				initialSelectedFile={null}
				onDeleteWorkspace={vi.fn()}
				allWorkspaces={[workspace]}
				{...({ onSessionCreated } as Record<string, unknown>)}
			/>,
		);

		const user = userEvent.setup();
		const changesTab = await screen.findByRole("tab", { name: /review/i });
		await user.click(changesTab);

		await waitFor(() => expect(changesDiffReviewHandler).toBeTruthy());

		const reviewMarkdown =
			"## Code Review\n\n### Summary\nPlease fix these issues\n";

		await act(async () => {
			await changesDiffReviewHandler?.(reviewMarkdown);
		});

		// Verify session creation with correct name
		expect(api.createSession).toHaveBeenCalledWith(
			workspace.repo_path,
			workspace.id,
			"Code Review",
		);

		// PTY session should NOT be created by the handler - ConsolidatedTerminal will create it
		expect(api.ptyCreateSession).not.toHaveBeenCalled();

		// Verify parent was notified with pending prompt
		expect(onSessionCreated).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: 42,
				sessionName: "Code Review",
				workspaceId: workspace.id,
				workspacePath: workspace.workspace_path,
				repoPath: workspace.repo_path,
				pendingPrompt: reviewMarkdown,
			}),
		);
	});
});

describe("Workspace bookmark conflict handling", () => {
	const conflictPayload = {
		workspace_id: workspace.id,
		workspace_name: workspace.workspace_name,
		workspace_path: workspace.workspace_path,
		branch_name: workspace.branch_name,
		bookmark: workspace.branch_name,
		commits: [
			{
				commit_id: "abc123def4567890",
				short_commit_id: "abc123def456",
				change_id: "xyz987",
				description: "Test conflict commit",
				author_name: "Dev Example",
				timestamp: "2025-01-01 10:00:00.000 +00:00",
				diff_summary: "1 files changed",
			},
		],
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("shows a modal when auto rebase reports a bookmark conflict", async () => {
		vi.mocked(api.checkAndRebaseWorkspaces).mockResolvedValueOnce({
			rebased: true,
			success: false,
			message: "Bookmark conflict",
			bookmark_conflicts: [conflictPayload],
		});

		render(
			<ShowWorkspace
				repositoryPath={workspace.repo_path}
				workspace={workspace}
				mainRepoBranch="main"
				initialSelectedFile={null}
			/>,
		);

		expect(
			await screen.findByText(/Resolve bookmark conflict/i),
		).toBeInTheDocument();
	});

	it("lets the user resolve the bookmark conflict from the modal", async () => {
		vi.mocked(api.checkAndRebaseWorkspaces)
			.mockResolvedValueOnce({
				rebased: true,
				success: false,
				message: "Bookmark conflict",
				bookmark_conflicts: [conflictPayload],
			})
			.mockResolvedValueOnce({
				rebased: false,
				success: true,
				message: "No rebase needed",
				bookmark_conflicts: [],
			});

		const user = userEvent.setup();

		render(
			<ShowWorkspace
				repositoryPath={workspace.repo_path}
				workspace={workspace}
				mainRepoBranch="main"
				initialSelectedFile={null}
			/>,
		);

		const resolveButton = await screen.findByRole("button", {
			name: /resolve conflict/i,
		});
		expect(
			screen.getByText(/all local commits will be preserved/i),
		).toBeInTheDocument();
		await user.click(resolveButton);

		await waitFor(() =>
			expect(api.resolveBookmarkConflict).toHaveBeenCalledWith(
				workspace.repo_path,
				workspace.id,
				workspace.workspace_path,
				workspace.branch_name,
			),
		);
	});
});

describe("ShowWorkspace rebasing indicator", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("displays rebasing indicator during auto-rebase on mount", async () => {
		// Mock a slow rebase operation
		vi.mocked(api.checkAndRebaseWorkspaces).mockImplementation(
			() =>
				new Promise((resolve) => {
					setTimeout(
						() =>
							resolve({
								rebased: true,
								success: true,
								has_conflicts: false,
								conflicted_files: [],
								message: "Rebased successfully",
							}),
						100,
					);
				}),
		);

		render(
			<ShowWorkspace
				repositoryPath={workspace.repo_path}
				workspace={workspace}
				mainRepoBranch="main"
				initialSelectedFile={null}
				onDeleteWorkspace={vi.fn()}
				allWorkspaces={[workspace]}
			/>,
		);

		// Rebasing indicator should appear while rebase is in progress
		await waitFor(() => {
			expect(screen.getByText("Rebasing...")).toBeInTheDocument();
		});

		// Verify checkAndRebaseWorkspaces was called with force=true
		expect(api.checkAndRebaseWorkspaces).toHaveBeenCalledWith(
			workspace.repo_path,
			workspace.id,
			"main",
			true,
		);

		// Wait for rebase to complete - indicator should disappear (min 500ms)
		await waitFor(
			() => {
				expect(screen.queryByText("Rebasing...")).not.toBeInTheDocument();
			},
			{ timeout: 700 },
		);
	});

	it("hides rebasing indicator after successful rebase (min 500ms)", async () => {
		vi.mocked(api.checkAndRebaseWorkspaces).mockResolvedValue({
			rebased: true,
			success: true,
			has_conflicts: false,
			conflicted_files: [],
			message: "Rebased successfully",
		});

		render(
			<ShowWorkspace
				repositoryPath={workspace.repo_path}
				workspace={workspace}
				mainRepoBranch="main"
				initialSelectedFile={null}
				onDeleteWorkspace={vi.fn()}
				allWorkspaces={[workspace]}
			/>,
		);

		// Wait for rebase to complete
		await waitFor(() => {
			expect(api.checkAndRebaseWorkspaces).toHaveBeenCalled();
		});

		// Indicator should remain visible for at least 500ms
		expect(screen.getByText("Rebasing...")).toBeInTheDocument();

		// Wait for minimum visibility duration
		await waitFor(
			() => {
				expect(screen.queryByText("Rebasing...")).not.toBeInTheDocument();
			},
			{ timeout: 700 },
		);

		// No success toast should be shown (only status indicator was displayed)
		expect(screen.queryByText("Workspace rebased")).not.toBeInTheDocument();
	});

	it("hides rebasing indicator after rebase with conflicts (min 500ms)", async () => {
		vi.mocked(api.checkAndRebaseWorkspaces).mockResolvedValue({
			rebased: true,
			success: true,
			has_conflicts: true,
			conflicted_files: ["src/App.tsx", "src/utils.ts"],
			message: "Rebased with conflicts",
		});

		render(
			<ShowWorkspace
				repositoryPath={workspace.repo_path}
				workspace={workspace}
				mainRepoBranch="main"
				initialSelectedFile={null}
				onDeleteWorkspace={vi.fn()}
				allWorkspaces={[workspace]}
			/>,
		);

		// Wait for rebase to complete
		await waitFor(() => {
			expect(api.checkAndRebaseWorkspaces).toHaveBeenCalled();
		});

		// Indicator should remain visible for at least 500ms
		expect(screen.getByText("Rebasing...")).toBeInTheDocument();

		// Wait for minimum visibility duration
		await waitFor(
			() => {
				expect(screen.queryByText("Rebasing...")).not.toBeInTheDocument();
			},
			{ timeout: 700 },
		);

		// Conflict toast should be shown
		await waitFor(() => {
			expect(
				screen.getByText("Workspace rebased with conflicts"),
			).toBeInTheDocument();
		});
	});

	it("hides rebasing indicator after rebase error (min 500ms)", async () => {
		vi.mocked(api.checkAndRebaseWorkspaces).mockRejectedValue(
			new Error("Rebase command failed"),
		);

		render(
			<ShowWorkspace
				repositoryPath={workspace.repo_path}
				workspace={workspace}
				mainRepoBranch="main"
				initialSelectedFile={null}
				onDeleteWorkspace={vi.fn()}
				allWorkspaces={[workspace]}
			/>,
		);

		// Wait for rebase to fail
		await waitFor(() => {
			expect(api.checkAndRebaseWorkspaces).toHaveBeenCalled();
		});

		// Indicator should remain visible for at least 500ms even on error
		expect(screen.getByText("Rebasing...")).toBeInTheDocument();

		// Wait for minimum visibility duration
		await waitFor(
			() => {
				expect(screen.queryByText("Rebasing...")).not.toBeInTheDocument();
			},
			{ timeout: 700 },
		);

		// No error toast should be shown (silent failure for auto-rebase)
		expect(screen.queryByText("Rebase failed")).not.toBeInTheDocument();
	});

	it("does not show success toast on successful rebase", async () => {
		vi.mocked(api.checkAndRebaseWorkspaces).mockResolvedValue({
			rebased: true,
			success: true,
			has_conflicts: false,
			conflicted_files: [],
			message: "Rebased successfully",
		});

		render(
			<ShowWorkspace
				repositoryPath={workspace.repo_path}
				workspace={workspace}
				mainRepoBranch="main"
				initialSelectedFile={null}
				onDeleteWorkspace={vi.fn()}
				allWorkspaces={[workspace]}
			/>,
		);

		await waitFor(() => {
			expect(api.checkAndRebaseWorkspaces).toHaveBeenCalled();
		});

		// Wait a bit to ensure no toast appears
		await new Promise((resolve) => setTimeout(resolve, 100));

		// Verify no success toast is displayed
		expect(screen.queryByText("Workspace rebased")).not.toBeInTheDocument();
	});
});

describe("ShowWorkspace target branch change invalidation", () => {
	beforeEach(() => {
		targetBranchSelectHandler = null;
		vi.clearAllMocks();
	});

	it("invalidates workspace and status queries when target branch is changed", async () => {
		const { QueryClient } = await import("@tanstack/react-query");
		const invalidateSpy = vi.spyOn(QueryClient.prototype, "invalidateQueries");

		vi.mocked(api.setWorkspaceTargetBranch).mockResolvedValue({
			success: true,
			message: "Rebased successfully",
		});

		render(
			<ShowWorkspace
				repositoryPath={workspace.repo_path}
				workspace={workspace}
				mainRepoBranch="main"
				initialSelectedFile={null}
				onDeleteWorkspace={vi.fn()}
				allWorkspaces={[workspace]}
			/>,
		);

		// Wait for component to mount and capture the handler
		await waitFor(() => expect(targetBranchSelectHandler).toBeTruthy());

		// Clear any invalidation calls from mount/auto-rebase
		invalidateSpy.mockClear();

		// Simulate selecting a new target branch
		await act(async () => {
			await targetBranchSelectHandler!("develop");
		});

		// Verify sidebar queries were invalidated
		expect(invalidateSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				queryKey: ["workspaces", workspace.repo_path],
			}),
		);
		expect(invalidateSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				queryKey: ["workspace-statuses", workspace.repo_path],
			}),
		);

		invalidateSpy.mockRestore();
	});

	it("does not invalidate queries when target branch change fails", async () => {
		const { QueryClient } = await import("@tanstack/react-query");
		const invalidateSpy = vi.spyOn(QueryClient.prototype, "invalidateQueries");

		vi.mocked(api.setWorkspaceTargetBranch).mockResolvedValue({
			success: false,
			message: "Rebase failed: conflicts",
		});

		render(
			<ShowWorkspace
				repositoryPath={workspace.repo_path}
				workspace={workspace}
				mainRepoBranch="main"
				initialSelectedFile={null}
				onDeleteWorkspace={vi.fn()}
				allWorkspaces={[workspace]}
			/>,
		);

		await waitFor(() => expect(targetBranchSelectHandler).toBeTruthy());

		invalidateSpy.mockClear();

		await act(async () => {
			await targetBranchSelectHandler!("develop");
		});

		// Should NOT have invalidated workspace/status queries on failure
		const workspaceInvalidations = invalidateSpy.mock.calls.filter(
			(call) =>
				Array.isArray(call[0]?.queryKey) &&
				(call[0].queryKey[0] === "workspaces" ||
					call[0].queryKey[0] === "workspace-statuses"),
		);
		expect(workspaceInvalidations).toHaveLength(0);

		invalidateSpy.mockRestore();
	});
});
