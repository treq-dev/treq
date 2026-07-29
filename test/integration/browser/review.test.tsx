import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../src/lib/api";
import type { PickedElement } from "../../../src/lib/api-types";
import {
	type Workspace,
	createWorkspace,
	getWorkspaces,
} from "../../../src/lib/api";
import { render, screen, waitFor } from "../../test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import userEvent from "@testing-library/user-event";
import {
	createTestRepo,
	findSidebarBranchElement,
	openRepo,
} from "../../utils";

async function setupWorkspace(branchName: string): Promise<{
	repoPath: string;
	workspace: Workspace;
}> {
	const { repoPath } = createTestRepo(false);
	openRepo(repoPath);

	const workspaceId = await createWorkspace(repoPath, branchName);
	const workspace = (await getWorkspaces(repoPath)).find(
		(item) => item.id === workspaceId,
	);
	if (!workspace) {
		throw new Error(`Workspace not found for id ${workspaceId}`);
	}

	return { repoPath, workspace };
}

async function openBrowserTab(
	user: ReturnType<typeof userEvent.setup>,
	branchName: string,
) {
	render(<Dashboard />);

	await user.click(await findSidebarBranchElement(branchName));

	const browserTab = await screen.findByRole("tab", { name: /^Browser/ });
	await user.click(browserTab);
	await screen.findByRole("tab", { name: /^Browser/, selected: true });
}

async function loadPage(user: ReturnType<typeof userEvent.setup>, url: string) {
	const input = await screen.findByLabelText(/browser url/i);
	await user.clear(input);
	await user.type(input, url);
	await user.click(screen.getByRole("button", { name: /^go$/i }));
}

async function pickElement(
	capturePicked: () => (element: PickedElement) => void,
	element: PickedElement,
) {
	await screen.findByRole("button", { name: /select element/i });
	capturePicked()(element);
}

const SAMPLE_ELEMENT: PickedElement = {
	selector: "#checkout > button.primary",
	tag: "BUTTON",
	text_preview: "Place order",
	x: 10,
	y: 20,
	width: 120,
	height: 32,
};

describe("BrowserPanel - page review integration", () => {
	let user: ReturnType<typeof userEvent.setup>;
	let pickedCallback: ((element: PickedElement) => void) | null;

	beforeEach(() => {
		user = userEvent.setup();
		pickedCallback = null;

		vi.spyOn(api, "openBrowserWebview").mockResolvedValue(undefined);
		vi.spyOn(api, "navigateBrowserWebview").mockResolvedValue(undefined);
		vi.spyOn(api, "closeBrowserWebview").mockResolvedValue(undefined);
		vi.spyOn(api, "setBrowserSelectMode").mockResolvedValue(undefined);
		vi.spyOn(api, "syncBrowserWebviewBounds").mockResolvedValue(undefined);
		vi.spyOn(api, "listenBrowserElementPicked").mockImplementation(
			(callback) => {
				pickedCallback = callback;
				return Promise.resolve(() => {});
			},
		);
		vi.spyOn(api, "listenBrowserUrlChanged").mockImplementation(() =>
			Promise.resolve(() => {}),
		);
	});

	it("rejects a non-localhost URL and accepts a localhost URL", async () => {
		const { workspace } = await setupWorkspace("feat/browser-validation");
		await openBrowserTab(user, workspace.branch_name);

		const input = await screen.findByLabelText(/browser url/i);
		await user.clear(input);
		await user.type(input, "https://example.com");
		expect(screen.getByRole("button", { name: /^go$/i })).toBeDisabled();
		expect(api.openBrowserWebview).not.toHaveBeenCalled();

		await user.clear(input);
		await user.type(input, "http://localhost:5173/app");
		expect(screen.getByRole("button", { name: /^go$/i })).toBeEnabled();
		await user.click(screen.getByRole("button", { name: /^go$/i }));

		await waitFor(() => {
			expect(api.openBrowserWebview).toHaveBeenCalledWith(
				"http://localhost:5173/app",
				expect.any(Number),
				expect.any(Number),
				expect.any(Number),
				expect.any(Number),
			);
		});
	});

	it("adds multiple element comments and autosaves the pending review", async () => {
		const { repoPath, workspace } = await setupWorkspace(
			"feat/browser-comments",
		);
		await openBrowserTab(user, workspace.branch_name);
		await loadPage(user, "http://localhost:3000/");

		await user.click(
			await screen.findByRole("button", { name: /select element/i }),
		);

		await pickElement(() => pickedCallback!, SAMPLE_ELEMENT);
		await user.type(
			await screen.findByPlaceholderText(/add a comment/i),
			"This should be disabled while submitting",
		);
		await user.click(
			screen
				.getAllByRole("button", { name: /add comment/i })
				.find((button) => button.textContent === "Add Comment")!,
		);

		await screen.findByText("This should be disabled while submitting");
		expect(screen.getByText(/#checkout > button.primary/)).toBeTruthy();

		await waitFor(async () => {
			const pending = await api.loadPendingPageReview(repoPath, workspace.id);
			expect(pending?.comments).toHaveLength(1);
			expect(pending?.comments[0].selector).toBe("#checkout > button.primary");
		});
	});

	it("sends a multi-comment review with a summary to a new agent terminal session", async () => {
		const { workspace } = await setupWorkspace("feat/browser-agent-handoff");
		await openBrowserTab(user, workspace.branch_name);
		await loadPage(user, "http://localhost:3000/");

		const createSessionSpy = vi.spyOn(api, "createSession");

		await user.click(
			await screen.findByRole("button", { name: /select element/i }),
		);
		await pickElement(() => pickedCallback!, SAMPLE_ELEMENT);
		await user.type(
			await screen.findByPlaceholderText(/add a comment/i),
			"First comment",
		);
		await user.click(
			screen
				.getAllByRole("button", { name: /add comment/i })
				.find((button) => button.textContent === "Add Comment")!,
		);
		await screen.findByText("First comment");

		await pickElement(() => pickedCallback!, {
			...SAMPLE_ELEMENT,
			selector: "#hero > h1",
			tag: "H1",
			text_preview: "Welcome",
		});
		await user.type(
			await screen.findByPlaceholderText(/add a comment/i),
			"Second comment",
		);
		await user.click(
			screen
				.getAllByRole("button", { name: /add comment/i })
				.find((button) => button.textContent === "Add Comment")!,
		);
		await screen.findByText("Second comment");

		await user.click(
			await screen.findByRole("button", { name: /finish review/i }),
		);
		await user.type(
			await screen.findByPlaceholderText(/add a summary comment/i),
			"Overall looks solid",
		);
		await user.click(await screen.findByRole("button", { name: /^plan$/i }));

		await waitFor(() => {
			expect(createSessionSpy).toHaveBeenCalledWith(
				workspace.repo_path,
				workspace.id,
				"Page Review",
			);
		});
	});

	it("discards the review and clears persisted state", async () => {
		const { repoPath, workspace } = await setupWorkspace(
			"feat/browser-discard",
		);
		await openBrowserTab(user, workspace.branch_name);
		await loadPage(user, "http://localhost:3000/");

		await user.click(
			await screen.findByRole("button", { name: /select element/i }),
		);
		await pickElement(() => pickedCallback!, SAMPLE_ELEMENT);
		await user.type(
			await screen.findByPlaceholderText(/add a comment/i),
			"Temporary comment",
		);
		await user.click(
			screen
				.getAllByRole("button", { name: /add comment/i })
				.find((button) => button.textContent === "Add Comment")!,
		);
		await screen.findByText("Temporary comment");

		await waitFor(async () => {
			const pending = await api.loadPendingPageReview(repoPath, workspace.id);
			expect(pending?.comments).toHaveLength(1);
		});

		const discardButtons = screen.getAllByRole("button", {
			name: /^discard$/i,
		});
		await user.click(discardButtons[0]);
		const confirmButtons = screen.getAllByRole("button", {
			name: /^discard$/i,
		});
		await user.click(confirmButtons[confirmButtons.length - 1]);

		await waitFor(async () => {
			const pending = await api.loadPendingPageReview(repoPath, workspace.id);
			expect(pending).toBeNull();
		});
	});
});
