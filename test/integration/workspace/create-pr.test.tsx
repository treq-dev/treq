import * as React from "react";
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Dashboard } from "../../../src/components/Dashboard";
import {
	createWorkspace,
	getWorkspaces,
	ghCreatePr,
	ghViewPr,
	getPrInfoViaGh,
	pushWorkspaceToRemote,
	updateWorkspace,
} from "../../../src/lib/api";
import { createTestRepo, openRepo } from "../../utils";
import { render, screen, waitFor, within } from "../../test-utils";
import userEvent from "@testing-library/user-event";

vi.mock("../../../src/lib/api", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("../../../src/lib/api")>();
	return {
		...original,
		pushWorkspaceToRemote: vi.fn(original.pushWorkspaceToRemote),
		getPrInfoViaGh: vi.fn().mockResolvedValue(null),
		ghCreatePr: vi.fn().mockResolvedValue(42),
		ghViewPr: vi.fn(),
		ghListPrs: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
		ghListIssues: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
	};
});

function setOriginUrl(repoPath: string, remoteUrl: string) {
	const configPath = path.join(repoPath, ".git", "config");
	let config = fs.readFileSync(configPath, "utf-8");
	if (/\[remote "origin"\][\s\S]*?url\s*=/.test(config)) {
		config = config.replace(
			/(\[remote "origin"\][\s\S]*?url\s*=\s*).*/m,
			`$1${remoteUrl}`,
		);
	} else {
		config += `\n[remote "origin"]\n\turl = ${remoteUrl}\n`;
	}
	fs.writeFileSync(configPath, config);
}

describe("ShowWorkspace - Create PR", () => {
	let repoPath: string;
	let user: ReturnType<typeof userEvent.setup>;

	beforeEach(() => {
		({ repoPath } = createTestRepo(true));
		openRepo(repoPath);
		user = userEvent.setup();
		vi.mocked(getPrInfoViaGh).mockReset().mockResolvedValue(null);
		vi.mocked(ghCreatePr).mockReset().mockResolvedValue(42);
		vi.mocked(pushWorkspaceToRemote).mockClear();
		vi.mocked(openUrl).mockReset();
	});

	async function setupPushedWorkspaceWithGitHub(options?: {
		title?: string;
		description?: string;
		githubRemote?: boolean;
	}) {
		const title = options?.title ?? "Ship the feature";
		const description =
			options?.description ?? "Implements the feature end-to-end.";
		const workspaceId = await createWorkspace(repoPath, "feat/create-pr");
		await updateWorkspace(repoPath, workspaceId, undefined, title, description);
		await pushWorkspaceToRemote(repoPath, workspaceId);

		if (options?.githubRemote !== false) {
			setOriginUrl(repoPath, "https://github.com/acme/treq.git");
		}

		const workspace = (await getWorkspaces(repoPath)).find(
			(w) => w.branch_name === "feat/create-pr",
		);
		expect(workspace?.not_on_remote).toBe(false);
		return { workspace: workspace!, title, description };
	}

	it("shows Create PR instead of Push after the branch is on remote with GitHub", async () => {
		await setupPushedWorkspaceWithGitHub();
		render(<Dashboard />);

		await user.click(await screen.findByText("feat/create-pr"));
		const header = await screen.findByTestId("show-workspace-header");

		expect(
			await within(header).findByRole("button", { name: /^create pr$/i }),
		).toBeVisible();
		expect(
			within(header).queryByRole("button", { name: /push to remote/i }),
		).not.toBeInTheDocument();
	});

	it("shows tooltips and a dark-mode border for the Create PR controls", async () => {
		await setupPushedWorkspaceWithGitHub();
		render(<Dashboard />);

		await user.click(await screen.findByText("feat/create-pr"));
		const header = await screen.findByTestId("show-workspace-header");
		const createPr = await within(header).findByRole("button", {
			name: /^create pr$/i,
		});
		const moreOptions = within(header).getByRole("button", {
			name: /more create pr options/i,
		});

		expect(createPr).toHaveClass("dark:border-white/30");
		expect(moreOptions).toHaveClass("dark:border-white/30");

		createPr.focus();
		expect(await screen.findByRole("tooltip")).toHaveTextContent(
			"Create a pull request on GitHub",
		);

		moreOptions.focus();
		await waitFor(() => {
			expect(
				screen
					.getAllByRole("tooltip")
					.some((tooltip) =>
						tooltip.textContent?.includes("More pull request options"),
					),
			).toBe(true);
		});
	});

	it("shows Create PR when a GitHub branch is not on remote", async () => {
		await createWorkspace(repoPath, "feat/unpushed");
		setOriginUrl(repoPath, "https://github.com/acme/treq.git");
		render(<Dashboard />);

		await user.click(await screen.findByText("feat/unpushed"));
		const header = await screen.findByTestId("show-workspace-header");

		expect(
			await within(header).findByRole("button", { name: /^create pr$/i }),
		).toBeVisible();
		expect(
			within(header).queryByRole("button", { name: /^push to remote$/i }),
		).not.toBeInTheDocument();
	});

	it("pushes an unpushed GitHub branch before creating its PR", async () => {
		const workspaceId = await createWorkspace(repoPath, "feat/unpushed-pr");
		setOriginUrl(repoPath, "https://github.com/acme/treq.git");
		let finishPush!: () => void;
		vi.mocked(pushWorkspaceToRemote).mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					finishPush = resolve;
				}),
		);
		render(<Dashboard />);

		await user.click(await screen.findByText("feat/unpushed-pr"));
		const header = await screen.findByTestId("show-workspace-header");
		await user.click(
			await within(header).findByRole("button", { name: /^create pr$/i }),
		);

		expect(pushWorkspaceToRemote).toHaveBeenCalledWith(repoPath, workspaceId);
		expect(ghCreatePr).not.toHaveBeenCalled();
		finishPush();
		await waitFor(() => expect(ghCreatePr).toHaveBeenCalled());
	});

	it("hides Create PR when there is no GitHub remote", async () => {
		await setupPushedWorkspaceWithGitHub({ githubRemote: false });
		render(<Dashboard />);

		await user.click(await screen.findByText("feat/create-pr"));
		const header = await screen.findByTestId("show-workspace-header");

		await waitFor(() => {
			expect(
				within(header).queryByRole("button", { name: /push to remote/i }),
			).not.toBeInTheDocument();
		});
		expect(
			within(header).queryByRole("button", { name: /^create pr$/i }),
		).not.toBeInTheDocument();
	});

	it("creates a PR with the workspace title and description", async () => {
		const { title, description } = await setupPushedWorkspaceWithGitHub();
		render(<Dashboard />);

		await user.click(await screen.findByText("feat/create-pr"));
		const header = await screen.findByTestId("show-workspace-header");
		await user.click(
			await within(header).findByRole("button", { name: /^create pr$/i }),
		);

		await waitFor(() => {
			expect(ghCreatePr).toHaveBeenCalledWith(
				"acme/treq",
				title,
				description,
				expect.any(String),
				"feat/create-pr",
				false,
			);
		});

		await user.click(
			await screen.findByRole("button", { name: /open in web/i }),
		);
		expect(openUrl).toHaveBeenCalledWith(
			"https://github.com/acme/treq/pull/42",
		);
	});

	it("creates a draft PR from the dropdown", async () => {
		const { title, description } = await setupPushedWorkspaceWithGitHub();
		render(<Dashboard />);

		await user.click(await screen.findByText("feat/create-pr"));
		const header = await screen.findByTestId("show-workspace-header");
		await user.click(
			within(header).getByRole("button", { name: /more create pr options/i }),
		);
		await user.click(
			await screen.findByRole("menuitem", { name: /create draft pr/i }),
		);

		await waitFor(() => {
			expect(ghCreatePr).toHaveBeenCalledWith(
				"acme/treq",
				title,
				description,
				expect.any(String),
				"feat/create-pr",
				true,
			);
		});
	});

	it("opens GitHub compare URL when creating a PR manually", async () => {
		await setupPushedWorkspaceWithGitHub();
		render(<Dashboard />);

		await user.click(await screen.findByText("feat/create-pr"));
		const header = await screen.findByTestId("show-workspace-header");
		await user.click(
			within(header).getByRole("button", { name: /more create pr options/i }),
		);
		await user.click(
			await screen.findByRole("menuitem", { name: /create pr manually/i }),
		);

		await waitFor(() => {
			expect(openUrl).toHaveBeenCalledWith(
				expect.stringContaining("https://github.com/acme/treq/compare/"),
			);
		});
		const url = vi.mocked(openUrl).mock.calls[0][0] as string;
		expect(url).toContain("feat%2Fcreate-pr");
		expect(url).toContain("title=Ship+the+feature");
		expect(url).toContain("body=Implements+the+feature+end-to-end.");
	});

	it("navigates to in-app GitHub PR detail on View PR; Open on Web opens browser", async () => {
		await setupPushedWorkspaceWithGitHub();
		vi.mocked(getPrInfoViaGh).mockResolvedValue({
			number: 9,
			title: "Existing",
			state: "OPEN",
			url: "https://github.com/acme/treq/pull/9",
			head_ref_name: "feat/create-pr",
			base_ref_name: "main",
			merge_state_status: "CLEAN",
			is_draft: false,
		});
		vi.mocked(ghViewPr).mockResolvedValue({
			number: 9,
			title: "Existing",
			state: "OPEN",
			url: "https://github.com/acme/treq/pull/9",
			body: "PR body",
			author: { login: "alice" },
			labels: [],
			head_ref_name: "feat/create-pr",
			base_ref_name: "main",
			merge_state_status: "CLEAN",
			created_at: "2026-01-01T00:00:00Z",
			updated_at: "2026-01-01T00:00:00Z",
			comments: null,
		});
		render(<Dashboard />);

		await user.click(await screen.findByText("feat/create-pr"));
		const header = await screen.findByTestId("show-workspace-header");

		const viewPr = await within(header).findByRole("button", {
			name: /view pr.*open/i,
		});
		expect(viewPr.className).toMatch(/border-green-600/);
		expect(
			within(header).queryByRole("button", { name: /^create pr$/i }),
		).not.toBeInTheDocument();

		await user.click(
			within(header).getByRole("button", { name: /open pr on web/i }),
		);
		expect(openUrl).toHaveBeenCalledWith("https://github.com/acme/treq/pull/9");
		vi.mocked(openUrl).mockClear();

		await user.click(viewPr);
		expect(openUrl).not.toHaveBeenCalled();
		expect(await screen.findByText("Existing")).toBeVisible();
		expect(ghViewPr).toHaveBeenCalledWith("acme/treq", 9);
	});

	it("shows tooltips for the View PR controls", async () => {
		await setupPushedWorkspaceWithGitHub();
		vi.mocked(getPrInfoViaGh).mockResolvedValue({
			number: 9,
			title: "Existing",
			state: "OPEN",
			url: "https://github.com/acme/treq/pull/9",
			head_ref_name: "feat/create-pr",
			base_ref_name: "main",
			merge_state_status: "CLEAN",
			is_draft: false,
		});
		render(<Dashboard />);

		await user.click(await screen.findByText("feat/create-pr"));
		const header = await screen.findByTestId("show-workspace-header");
		const viewPr = await within(header).findByRole("button", {
			name: /view pr.*open/i,
		});
		const openOnWeb = within(header).getByRole("button", {
			name: /open pr on web/i,
		});

		viewPr.focus();
		expect(await screen.findByRole("tooltip")).toHaveTextContent(
			"View pull request #9 in Treq",
		);

		openOnWeb.focus();
		await waitFor(() => {
			expect(
				screen
					.getAllByRole("tooltip")
					.some((tooltip) =>
						tooltip.textContent?.includes("Open pull request #9 on GitHub"),
					),
			).toBe(true);
		});
	});

	it("uses draft label when PR is a draft", async () => {
		await setupPushedWorkspaceWithGitHub();
		vi.mocked(getPrInfoViaGh).mockResolvedValue({
			number: 12,
			title: "Draft PR",
			state: "OPEN",
			url: "https://github.com/acme/treq/pull/12",
			head_ref_name: "feat/create-pr",
			base_ref_name: "main",
			merge_state_status: "CLEAN",
			is_draft: true,
		});
		render(<Dashboard />);

		await user.click(await screen.findByText("feat/create-pr"));
		const header = await screen.findByTestId("show-workspace-header");
		expect(
			await within(header).findByRole("button", { name: /view pr.*draft/i }),
		).toBeVisible();
	});

	it("styles View PR for closed and merged states", async () => {
		await setupPushedWorkspaceWithGitHub();
		vi.mocked(getPrInfoViaGh).mockResolvedValue({
			number: 10,
			title: "Closed",
			state: "CLOSED",
			url: "https://github.com/acme/treq/pull/10",
			head_ref_name: "feat/create-pr",
			base_ref_name: "main",
			merge_state_status: null,
		});
		const view = render(<Dashboard />);

		await user.click(await screen.findByText("feat/create-pr"));
		let header = await screen.findByTestId("show-workspace-header");
		const closed = await within(header).findByRole("button", {
			name: /view pr.*closed/i,
		});
		expect(closed.className).toMatch(/border-red-600/);

		view.unmount();
		vi.mocked(getPrInfoViaGh).mockResolvedValue({
			number: 11,
			title: "Merged",
			state: "MERGED",
			url: "https://github.com/acme/treq/pull/11",
			head_ref_name: "feat/create-pr",
			base_ref_name: "main",
			merge_state_status: null,
		});
		render(<Dashboard />);
		await user.click(await screen.findByText("feat/create-pr"));
		header = await screen.findByTestId("show-workspace-header");
		const merged = await within(header).findByRole("button", {
			name: /view pr.*merged/i,
		});
		expect(merged.className).toMatch(/border-purple-600/);
	});
});
