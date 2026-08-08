import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Dashboard } from "../../../src/components/Dashboard";
import { getWorkspaces } from "../../../src/lib/api";
import type { PrCiStatus } from "../../../src/lib/api-types";
import { render, screen, waitFor, within } from "../../../test/test-utils";
import {
	commitRepoFile,
	commitWorkspaceFile,
	createTestRepo,
	openRepo,
} from "../../../test/utils";
import { captureDocument } from "../capture";

const BRANCH_NAME = "feat/ci-status-demo";

// Merge queue is irrelevant to this flow and would otherwise need Supabase
// stubbed too -- turn it off so the header only shows the View PR / Create PR
// affordances this spec cares about.
vi.mock("../../../src/lib/features", () => ({
	FEATURES: {
		pro: true,
		stripePayments: false,
		emailSignup: false,
		mergeQueue: false,
	},
}));

const { mockGetCachedPrInfo, mockGetCachedPrCiStatus, mockGetGitRemoteUrl } =
	vi.hoisted(() => ({
		mockGetCachedPrInfo: vi.fn(),
		mockGetCachedPrCiStatus: vi.fn(),
		mockGetGitRemoteUrl: vi.fn(),
	}));

vi.mock("../../../src/lib/api", async () => {
	const actual = await vi.importActual<typeof import("../../../src/lib/api")>(
		"../../../src/lib/api",
	);
	return {
		...actual,
		getCachedPrInfo: mockGetCachedPrInfo,
		startPrStatusPolling: vi.fn(async () => undefined),
		stopPrStatusPolling: vi.fn(async () => undefined),
		refreshPrStatuses: vi.fn(async () => undefined),
		getCachedPrCiStatus: mockGetCachedPrCiStatus,
		// createTestRepo's remote is a local bare repo, so the real
		// get_git_remote_url returns null and the PR/CI hooks short-circuit.
		// Stub it to the GitHub remote a real user would have.
		getGitRemoteUrl: mockGetGitRemoteUrl,
	};
});

const REMOTE_INFO = {
	owner: "treq-dev",
	repo: "treq",
	full_name: "treq-dev/treq",
};

function ciStatus(overrides: Partial<PrCiStatus> = {}): PrCiStatus {
	return {
		state: "success",
		total: 2,
		passed: 2,
		failed: 0,
		pending: 0,
		checks: [
			{ name: "build", bucket: "pass", link: "https://github.com/x/1" },
			{ name: "lint", bucket: "pass", link: "https://github.com/x/2" },
		],
		...overrides,
	};
}

function stubPr() {
	mockGetCachedPrInfo.mockResolvedValue({
		number: 42,
		title: "CI status demo",
		state: "OPEN",
		url: "https://github.com/treq-dev/treq/pull/42",
		head_ref_name: BRANCH_NAME,
		base_ref_name: "main",
		merge_state_status: "CLEAN",
	});
	mockGetGitRemoteUrl.mockResolvedValue(REMOTE_INFO);
}

// Real repo + workspace + push, driven through the app's own affordances --
// the View PR / CI status buttons are gated on the branch existing on remote.
async function setupPushedWorkspace(user: ReturnType<typeof userEvent.setup>) {
	const { repoPath } = createTestRepo(true);
	openRepo(repoPath);
	await commitRepoFile(repoPath, "base.txt", "base", "Base commit");

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
		"demo-file.txt",
		"demo content",
		"Workspace commit for CI status demo",
	);

	await user.click(
		await screen.findByRole("button", { name: /more workspace actions/i }),
	);
	await user.click(
		await screen.findByRole("menuitem", { name: /push to remote/i }),
	);
	// The item calls preventDefault() in onSelect so the menu stays open;
	// close it so the rest of the header isn't left aria-hidden behind it.
	await user.keyboard("{Escape}");
	await waitFor(async () => {
		const pushed = (await getWorkspaces(repoPath)).find(
			(candidate) => candidate.branch_name === BRANCH_NAME,
		);
		expect(pushed?.not_on_remote).toBe(false);
	});
}

it("captures CI passing next to the View PR button", async () => {
	const user = userEvent.setup();
	stubPr();
	mockGetCachedPrCiStatus.mockResolvedValue(ciStatus());

	await setupPushedWorkspace(user);

	await screen.findByRole("button", { name: /view pr/i });
	await screen.findByRole("button", { name: /ci passed: 2\/2/i });
	await captureDocument(document, {
		name: "ci-status-indicator-01-success",
		expectations: [
			'A small green outlined pill button reading "2/2" with a check-circle icon sits immediately to the left of the green "View PR" button.',
			"The two buttons sit on the same row with normal spacing, not overlapping or wrapped onto separate lines.",
		],
	});
}, 120000);

it("captures CI failing next to the View PR button", async () => {
	const user = userEvent.setup();
	stubPr();
	mockGetCachedPrCiStatus.mockResolvedValue(
		ciStatus({
			state: "failure",
			passed: 1,
			failed: 1,
			checks: [
				{ name: "build", bucket: "pass", link: "https://github.com/x/1" },
				{ name: "test", bucket: "fail", link: "https://github.com/x/2" },
			],
		}),
	);

	await setupPushedWorkspace(user);

	await screen.findByRole("button", { name: /view pr/i });
	await screen.findByRole("button", { name: /ci failed: 1\/2/i });
	await captureDocument(document, {
		name: "ci-status-indicator-02-failure",
		expectations: [
			'A small red outlined pill button reading "1/2" with an X-circle icon sits immediately to the left of the "View PR" button.',
			"The failure indicator is clearly a different color (red) than a passing indicator would be (green).",
		],
	});
}, 120000);

it("captures CI still running (pending) next to the View PR button", async () => {
	const user = userEvent.setup();
	stubPr();
	mockGetCachedPrCiStatus.mockResolvedValue(
		ciStatus({
			state: "pending",
			passed: 1,
			pending: 1,
			checks: [
				{ name: "build", bucket: "pass", link: "https://github.com/x/1" },
				{ name: "test", bucket: "pending", link: "https://github.com/x/2" },
			],
		}),
	);

	await setupPushedWorkspace(user);

	await screen.findByRole("button", { name: /view pr/i });
	await screen.findByRole("button", { name: /ci running: 1\/2/i });
	await captureDocument(document, {
		name: "ci-status-indicator-03-pending",
		expectations: [
			'A small yellow outlined pill button reading "1/2" with a loader icon sits immediately to the left of the "View PR" button.',
			"The pending indicator is visually distinct in color (yellow) from both the green success and red failure states.",
		],
	});
}, 120000);
