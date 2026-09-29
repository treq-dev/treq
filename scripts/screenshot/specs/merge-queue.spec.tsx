import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Dashboard } from "../../../src/components/Dashboard";
import { getWorkspaces, pushWorkspaceToRemote } from "../../../src/lib/api";
import { invalidateQueries } from "../../../src/lib/swr-cache";
import type { WorkspaceQueueStatus } from "../../../src/lib/api-types";
import { render, screen, waitFor, within } from "../../../test/test-utils";
import {
	commitRepoFile,
	commitWorkspaceFile,
	createTestRepo,
	openRepo,
} from "../../../test/utils";
import { captureDocument } from "../capture";

const BRANCH_NAME = "feat/merge-queue-demo";

// The merge queue's server side lives in Supabase (RPCs + edge functions), which
// the desktop harness has no access to. Everything else here is real: real jj
// repo, real Rust dispatch, real React tree. Only the Supabase boundary and the
// `gh` subprocess are stubbed, and the stub is driven by a mutable holder so the
// spec can walk the workspace through each queue state the backend can emit.
const { queueState, mockInvoke, mockGetCachedPrInfo, mockGetGitRemoteUrl } =
	vi.hoisted(() => ({
		queueState: {
			current: null as WorkspaceQueueStatus | null,
			enabled: true,
		},
		mockInvoke: vi.fn(),
		mockGetCachedPrInfo: vi.fn(),
		mockGetGitRemoteUrl: vi.fn(),
	}));

vi.mock("../../../src/lib/features", () => ({
	FEATURES: {
		pro: true,
		stripePayments: false,
		emailSignup: false,
		mergeQueue: true,
	},
}));

vi.mock("../../../src/lib/supabase", () => ({
	supabase: {
		rpc: vi.fn(async (fn: string) => {
			if (fn === "get_merge_queue_enabled") {
				return { data: queueState.enabled, error: null };
			}
			if (fn === "set_merge_queue_enabled") {
				queueState.enabled = true;
				return { data: true, error: null };
			}
			if (fn === "get_workspace_queue_status") {
				return {
					data: queueState.current ? [queueState.current] : [],
					error: null,
				};
			}
			if (fn === "get_repo_branch_queue_statuses") {
				return {
					data: queueState.current
						? [
								{
									branch_name: BRANCH_NAME,
									pr_number: queueState.current.pr_number,
									status: queueState.current.status,
									position: queueState.current.position,
									target_branch: queueState.current.target_branch,
								},
							]
						: [],
					error: null,
				};
			}
			return { data: [], error: null };
		}),
		functions: { invoke: mockInvoke },
		auth: {
			getSession: vi
				.fn()
				.mockResolvedValue({ data: { session: null }, error: null }),
			onAuthStateChange: vi.fn().mockReturnValue({
				data: { subscription: { unsubscribe: vi.fn() } },
			}),
		},
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
		getCachedPrInfo: mockGetCachedPrInfo,
		startPrStatusPolling: vi.fn(async () => undefined),
		refreshPrBranchStatus: vi.fn(async () => undefined),
		stopPrStatusPolling: vi.fn(async () => undefined),
		refreshPrStatuses: vi.fn(async () => undefined),
		// createTestRepo's remote is a local bare repo, so the real
		// get_git_remote_url returns null and every queue code path short-circuits
		// on "Repository or branch not detected". Stub it to the GitHub remote a
		// real user would have.
		getGitRemoteUrl: mockGetGitRemoteUrl,
	};
});

const REMOTE_INFO = {
	owner: "treq-dev",
	repo: "treq",
	full_name: "treq-dev/treq",
};

function entry(
	status: WorkspaceQueueStatus["status"],
	overrides: Partial<WorkspaceQueueStatus> = {},
): WorkspaceQueueStatus {
	return {
		entry_id: "00000000-0000-0000-0000-000000000001",
		pr_number: 42,
		status,
		position: 1,
		target_branch: "main",
		lane_number: null,
		ci_run_status: null,
		failure_reason: null,
		enqueued_at: new Date().toISOString(),
		merged_at: null,
		...overrides,
	};
}

// Real repo + workspace + push, driven through the app's own affordances.
// Every spec below needs a branch that exists on the remote, since the merge
// queue button is gated on `!workspace.not_on_remote`.
async function setupRepo() {
	const { repoPath } = createTestRepo(true);
	openRepo(repoPath);
	await commitRepoFile(repoPath, "base.txt", "base", "Base commit");
	return { repoPath };
}

async function createAndPushWorkspace(
	user: ReturnType<typeof userEvent.setup>,
	repoPath: string,
) {
	// Create the workspace through the real "Stack" dialog rather than the
	// createWorkspace helper -- workspace creation is part of the scenario.
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
		"Workspace commit for queue",
	);

	await pushWorkspaceToRemote(repoPath, workspace.id);
	await invalidateQueries();
	await waitFor(async () => {
		const pushed = (await getWorkspaces(repoPath)).find(
			(candidate) => candidate.branch_name === BRANCH_NAME,
		);
		expect(pushed?.not_on_remote).toBe(false);
	});
	return workspace;
}

function stubHappyPath() {
	mockGetCachedPrInfo.mockResolvedValue({
		number: 42,
		title: "Merge queue demo",
		state: "OPEN",
		url: "https://github.com/treq-dev/treq/pull/42",
		head_ref_name: BRANCH_NAME,
		base_ref_name: "main",
		merge_state_status: "CLEAN",
	});
	mockInvoke.mockReset();
	mockInvoke.mockResolvedValue({ data: { ok: true }, error: null });
	mockGetGitRemoteUrl.mockResolvedValue(REMOTE_INFO);
	queueState.enabled = true;
}

it("captures enqueuing a workspace into the merge queue", async () => {
	const user = userEvent.setup();
	stubHappyPath();
	queueState.current = null;

	const { repoPath } = await setupRepo();
	render(<Dashboard />);
	await createAndPushWorkspace(user, repoPath);

	const addToQueue = await screen.findByRole("button", {
		name: /add to queue/i,
	});
	expect(addToQueue).toBeEnabled();
	await captureDocument(document, {
		name: "merge-queue-01-not-queued",
		expectations: [
			'The workspace header shows an outlined "Add to Queue" button with a merge (git-merge) icon.',
			'The header also still shows the "Merge..." button next to it.',
			"The workspace row in the left sidebar has no coloured status dot next to its branch name.",
		],
	});

	// Enqueue through the real button. The edge function is stubbed, so flip the
	// state the RPC reports before the post-mutation invalidation refetches.
	queueState.current = entry("queued", { position: 1 });
	await user.click(addToQueue);
	await screen.findByText("Added to merge queue");
	await screen.findByRole("button", { name: "Queued" });
	await captureDocument(document, {
		name: "merge-queue-02-queued",
		expectations: [
			'The queue button now reads "Queued" -- no position number -- and is filled/secondary-styled rather than outlined.',
			'A green success toast reads "Added to merge queue".',
			"The workspace row in the left sidebar shows a small yellow dot next to its branch name.",
		],
	});

	expect(mockInvoke).toHaveBeenCalledWith(
		"enqueue-workspace",
		expect.objectContaining({
			body: expect.objectContaining({
				branch_name: BRANCH_NAME,
				action: "enqueue",
			}),
		}),
	);
}, 120000);

// The status queries poll on a 30s interval, so each downstream queue state
// gets its own render with the state already in place rather than being driven
// by a mid-test refetch that the user has no way to trigger.
it("captures the testing state (CI running in a lane)", async () => {
	const user = userEvent.setup();
	stubHappyPath();
	queueState.current = entry("testing", { position: 1, lane_number: 2 });

	const { repoPath } = await setupRepo();
	render(<Dashboard />);
	await createAndPushWorkspace(user, repoPath);

	await screen.findByRole("button", { name: "Queued" });
	expect(
		screen.queryByRole("button", { name: /testing/i }),
	).not.toBeInTheDocument();
	await captureDocument(document, {
		name: "merge-queue-03-testing",
		expectations: [
			'The queue button reads "Queued" -- the header deliberately shows neither a "Testing…" label nor a position number.',
			"The sidebar dot for the workspace is blue (CI running) rather than yellow.",
		],
	});
}, 120000);

it("captures the merging state, which the frontend has no case for", async () => {
	const user = userEvent.setup();
	stubHappyPath();
	// 'merging' is a real value of the merge_queue_entry_status enum
	// (supabase/migrations/003_merge_queue.sql) but is absent from the
	// frontend's QueueEntryStatus union.
	queueState.current = entry("merging", { position: 1 });

	const { repoPath } = await setupRepo();
	render(<Dashboard />);
	await createAndPushWorkspace(user, repoPath);

	await screen.findByRole("button", { name: "Queued" });
	await captureDocument(document, {
		name: "merge-queue-04-merging",
		expectations: [
			"The entry is in the backend 'merging' state (the queue is landing it now).",
			'The queue button reads "Queued".',
			"The sidebar dot for the workspace is green (passed CI, merging now) -- not the neutral grey it used to be before 'merging' had a case.",
		],
	});
}, 120000);

it("captures the merged state", async () => {
	const user = userEvent.setup();
	stubHappyPath();
	queueState.current = entry("merged", {
		position: 0,
		merged_at: new Date().toISOString(),
	});

	const { repoPath } = await setupRepo();
	render(<Dashboard />);
	await createAndPushWorkspace(user, repoPath);

	await screen.findByRole("button", { name: /add to queue/i });
	await captureDocument(document, {
		name: "merge-queue-05-merged",
		expectations: [
			'Once the entry merges, the button reverts to the outlined "Add to Queue" label.',
			"The sidebar dot for the workspace is dark green (merged via queue).",
		],
	});
}, 120000);

it("captures the error toast when the branch has no open PR", async () => {
	const user = userEvent.setup();
	stubHappyPath();
	// gh positively reports the branch's PR is closed -- the hook should refuse
	// to enqueue and surface the reason rather than calling the edge function.
	mockGetCachedPrInfo.mockResolvedValue({
		number: 7,
		title: "Closed PR",
		state: "CLOSED",
		url: "https://github.com/treq-dev/treq/pull/7",
		head_ref_name: BRANCH_NAME,
		base_ref_name: "main",
		merge_state_status: "DIRTY",
	});
	queueState.current = null;

	const { repoPath } = await setupRepo();
	render(<Dashboard />);
	await createAndPushWorkspace(user, repoPath);

	await user.click(
		await screen.findByRole("button", { name: /add to queue/i }),
	);
	await screen.findByText("Queue error");
	// Assert the actual reason, not just that *some* error surfaced -- a missing
	// remote would otherwise produce the same "Queue error" title.
	await screen.findByText(/gh reports: CLOSED/);
	await captureDocument(document, {
		name: "merge-queue-06-closed-pr-error",
		expectations: [
			'A red/destructive error toast reads "Queue error" with a description naming the branch and that gh reports CLOSED.',
			'The queue button is still the outlined "Add to Queue" -- nothing was enqueued.',
		],
	});

	expect(mockInvoke).not.toHaveBeenCalled();
}, 120000);
