import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Dashboard } from "../../../src/components/Dashboard";
import { getWorkspaces } from "../../../src/lib/api";
import { render, screen, waitFor, within } from "../../../test/test-utils";
import {
	commitRepoFile,
	commitWorkspaceFile,
	createTestRepo,
	openRepo,
} from "../../../test/utils";
import { captureDocument } from "../capture";

const BRANCH_NAME = "feat/flag-off-demo";

// Regression guard: with the mergeQueue build flag off, the merge queue must
// leave no trace -- no button, no sidebar dots, no tab, and crucially no
// Supabase polling. The flag used to gate only the button, so every user with a
// GitHub remote was polling the queue RPCs every 30s for a feature that was
// switched off.
const { rpcCalls, mockGetGitRemoteUrl } = vi.hoisted(() => ({
	rpcCalls: [] as string[],
	mockGetGitRemoteUrl: vi.fn(),
}));

vi.mock("../../../src/lib/features", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../../src/lib/features")>();
	return {
		...actual,
		FEATURES: {
			...actual.FEATURES,
			pro: true,
			stripePayments: false,
			emailSignup: false,
			mergeQueue: false,
		},
	};
});

vi.mock("../../../src/lib/supabase", () => ({
	supabase: {
		rpc: vi.fn(async (fn: string) => {
			rpcCalls.push(fn);
			if (fn === "get_merge_queue_enabled") {
				return { data: true, error: null };
			}
			return { data: [], error: null };
		}),
		functions: { invoke: vi.fn() },
	},
	SUPABASE_URL: "http://localhost:54321",
	SUPABASE_ANON_KEY: "anon",
	WEB_URL: "http://localhost:3000",
}));

vi.mock("../../../src/lib/api", async () => {
	const actual = await vi.importActual<typeof import("../../../src/lib/api")>(
		"../../../src/lib/api",
	);
	return {
		...actual,
		getGitRemoteUrl: mockGetGitRemoteUrl,
		ghCreatePr: vi.fn().mockResolvedValue(101),
	};
});

it("captures a pushed workspace with the merge queue flag switched off", async () => {
	const { repoPath } = createTestRepo(true);
	openRepo(repoPath);
	await commitRepoFile(repoPath, "base.txt", "base", "Base commit");

	// A GitHub remote *and* a repo whose queue is enabled server-side: the only
	// thing keeping the merge queue out of the UI is the build flag.
	mockGetGitRemoteUrl.mockResolvedValue({
		owner: "treq-dev",
		repo: "treq",
		full_name: "treq-dev/treq",
	});
	rpcCalls.length = 0;

	const user = userEvent.setup();
	render(<Dashboard />);

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

	const workspace = (await getWorkspaces(repoPath)).find(
		(candidate) => candidate.branch_name === BRANCH_NAME,
	);
	if (!workspace) throw new Error(`Expected ${BRANCH_NAME} workspace to exist`);
	await commitWorkspaceFile(
		repoPath,
		{ id: workspace.id, path: workspace.workspace_path },
		"queue-file.txt",
		"queue content",
		"Workspace commit",
	);

	await user.click(
		await screen.findByRole("button", { name: /^create pr$/i }),
	);
	await waitFor(() => {
		expect(
			screen.queryByRole("button", { name: /pushing & creating/i }),
		).not.toBeInTheDocument();
	});

	// Same repo state that renders "Add to Queue" with the flag on.
	expect(
		screen.queryByRole("button", { name: /add to queue/i }),
	).not.toBeInTheDocument();

	// Give any stray polling a chance to fire before asserting it did not.
	await new Promise((resolve) => setTimeout(resolve, 500));
	expect(rpcCalls).not.toContain("get_merge_queue_enabled");
	expect(rpcCalls).not.toContain("get_workspace_queue_status");
	expect(rpcCalls).not.toContain("get_repo_branch_queue_statuses");

	await captureDocument(document, {
		name: "merge-queue-flag-off-01-workspace",
		expectations: [
			'The workspace header has no "Add to Queue" button -- only the PR button ("Create PR"), "Merge..." and the overflow menu.',
			"The workspace row in the left sidebar has no coloured queue status dot.",
			"The workspace is pushed to its remote, so this is the exact state that shows the queue button when the flag is on.",
		],
	});

	await user.click(await screen.findByRole("button", { name: /github/i }));
	await screen.findByRole("tab", { name: /issues/i });
	expect(
		screen.queryByRole("tab", { name: /merge queue/i }),
	).not.toBeInTheDocument();
	await captureDocument(document, {
		name: "merge-queue-flag-off-02-github-panel",
		expectations: [
			'The GitHub panel shows only two tabs, "Issues" and "Pull Requests".',
			'There is no "Merge Queue" tab and no PRO upsell for it.',
		],
	});
}, 120000);
