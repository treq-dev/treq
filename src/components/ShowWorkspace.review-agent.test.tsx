import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "../../test/test-utils";
import { ShowWorkspace } from "./ShowWorkspace";
import type { Workspace } from "../lib/api";
import type { SessionCreationInfo } from "../types/sessions";

// Capture the onCreateAgentWithReview callback so tests can invoke it directly.
let capturedOnCreateAgentWithReview:
	| ((review: string, mode: "plan" | "acceptEdits") => Promise<void>)
	| undefined;

vi.mock("./FileBrowser", () => ({
	FileBrowser: () => <div data-testid="file-browser" />,
}));

vi.mock("./LinearCommitHistory", () => ({
	LinearCommitHistory: () => <div data-testid="linear-commit-history" />,
}));

vi.mock("./ChangesDiffViewer", () => ({
	ChangesDiffViewer: ({
		onCreateAgentWithReview,
	}: {
		onCreateAgentWithReview?: (
			review: string,
			mode: "plan" | "acceptEdits",
		) => Promise<void>;
	}) => {
		capturedOnCreateAgentWithReview = onCreateAgentWithReview;
		return <div data-testid="changes-viewer" />;
	},
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
		listCommits: vi.fn().mockResolvedValue({
			commits: [],
			target_branch: "main",
			workspace_branch: "feature-one",
		}),
	};
});

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

function renderWorkspace(onSessionCreated: (s: SessionCreationInfo) => void) {
	capturedOnCreateAgentWithReview = undefined;
	return render(
		<ShowWorkspace
			repositoryPath={workspace.repo_path}
			workspace={workspace}
			mainRepoBranch="main"
			initialSelectedFile={null}
			onDeleteWorkspace={vi.fn()}
			onSessionCreated={onSessionCreated}
		/>,
	);
}

async function openReviewTab() {
	const user = userEvent.setup();
	const reviewTab = await screen.findByRole("tab", { name: /review/i });
	await user.click(reviewTab);
	await screen.findByTestId("changes-viewer");
	await waitFor(() => expect(capturedOnCreateAgentWithReview).toBeDefined());
}

describe("Send review to terminal respects default agent setting", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		capturedOnCreateAgentWithReview = undefined;
	});

	it("passes agent=undefined when no default agent is configured", async () => {
		const api = await import("../lib/api");
		vi.mocked(api.getRepoSetting).mockResolvedValue(null);
		vi.mocked(api.getSetting).mockResolvedValue(null);

		const onSessionCreated = vi.fn();
		renderWorkspace(onSessionCreated);

		await openReviewTab();

		await capturedOnCreateAgentWithReview!("review text", "plan");

		expect(onSessionCreated).toHaveBeenCalledOnce();
		const [sessionInfo] = onSessionCreated.mock.calls[0] as [
			SessionCreationInfo,
		];
		expect(sessionInfo.agent).toBeUndefined();
	});

	it("passes agent=codex when repo default_agent is codex", async () => {
		const api = await import("../lib/api");
		vi.mocked(api.getRepoSetting).mockResolvedValue("codex");
		vi.mocked(api.getSetting).mockResolvedValue(null);

		const onSessionCreated = vi.fn();
		renderWorkspace(onSessionCreated);

		await openReviewTab();

		await capturedOnCreateAgentWithReview!("review text", "plan");

		expect(onSessionCreated).toHaveBeenCalledOnce();
		const [sessionInfo] = onSessionCreated.mock.calls[0] as [
			SessionCreationInfo,
		];
		expect(sessionInfo.agent).toBe("codex");
	});

	it("passes agent=cursor when repo default_agent is cursor", async () => {
		const api = await import("../lib/api");
		vi.mocked(api.getRepoSetting).mockResolvedValue("cursor");
		vi.mocked(api.getSetting).mockResolvedValue(null);

		const onSessionCreated = vi.fn();
		renderWorkspace(onSessionCreated);

		await openReviewTab();

		await capturedOnCreateAgentWithReview!("review text", "acceptEdits");

		expect(onSessionCreated).toHaveBeenCalledOnce();
		const [sessionInfo] = onSessionCreated.mock.calls[0] as [
			SessionCreationInfo,
		];
		expect(sessionInfo.agent).toBe("cursor");
	});

	it("repo setting takes precedence over app-level default_agent", async () => {
		const api = await import("../lib/api");
		vi.mocked(api.getRepoSetting).mockResolvedValue("codex");
		vi.mocked(api.getSetting).mockResolvedValue("cursor");

		const onSessionCreated = vi.fn();
		renderWorkspace(onSessionCreated);

		await openReviewTab();

		await capturedOnCreateAgentWithReview!("review text", "plan");

		expect(onSessionCreated).toHaveBeenCalledOnce();
		const [sessionInfo] = onSessionCreated.mock.calls[0] as [
			SessionCreationInfo,
		];
		expect(sessionInfo.agent).toBe("codex");
	});

	it("falls back to app-level default_agent when no repo setting", async () => {
		const api = await import("../lib/api");
		vi.mocked(api.getRepoSetting).mockResolvedValue(null);
		vi.mocked(api.getSetting).mockResolvedValue("codex");

		const onSessionCreated = vi.fn();
		renderWorkspace(onSessionCreated);

		await openReviewTab();

		await capturedOnCreateAgentWithReview!("review text", "plan");

		expect(onSessionCreated).toHaveBeenCalledOnce();
		const [sessionInfo] = onSessionCreated.mock.calls[0] as [
			SessionCreationInfo,
		];
		expect(sessionInfo.agent).toBe("codex");
	});

	it("includes the review markdown in the pending prompt", async () => {
		const api = await import("../lib/api");
		vi.mocked(api.getRepoSetting).mockResolvedValue("codex");
		vi.mocked(api.getSetting).mockResolvedValue(null);

		const onSessionCreated = vi.fn();
		renderWorkspace(onSessionCreated);

		await openReviewTab();

		const reviewText = "## Code Review\n\nPlease fix the bug.";
		await capturedOnCreateAgentWithReview!(reviewText, "plan");

		const [sessionInfo] = onSessionCreated.mock.calls[0] as [
			SessionCreationInfo,
		];
		expect(sessionInfo.pendingPrompt).toBe(reviewText);
		expect(sessionInfo.permissionMode).toBe("plan");
	});
});
