import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "../../test/test-utils";
import type { Workspace } from "../lib/api";
import { AgentPromptDialog } from "./AgentPromptDialog";

vi.mock("./TaskInput", () => ({
	TaskInput: ({
		onSessionCreated,
		initialText,
	}: {
		onSessionCreated: (value: unknown) => void;
		initialText?: string;
	}) => (
		<div>
			<div data-testid="task-input-initial-text">{initialText ?? ""}</div>
			<button onClick={() => onSessionCreated({ sessionId: 12 })}>
				Shared prompt input
			</button>
		</div>
	),
}));

const workspace: Workspace = {
	id: 2,
	repo_path: "/repo",
	workspace_name: "feat-one",
	workspace_path: "/repo/.treq/feat-one",
	branch_name: "feat/one",
	created_at: "now",
	title: "Feature one",
	not_on_remote: false,
};

describe("AgentPromptDialog", () => {
	it("defaults to the repo branch, selects searchable workspaces, and closes after starting", async () => {
		const user = userEvent.setup();
		const onOpenChange = vi.fn();
		const onSessionCreated = vi.fn();
		render(
			<AgentPromptDialog
				open
				onOpenChange={onOpenChange}
				repoPath="/repo"
				defaultBranch="main"
				workspaces={[workspace]}
				onSessionCreated={onSessionCreated}
			/>,
		);

		expect(
			screen.getByRole("heading", { name: "Start a new agent session" }),
		).toBeTruthy();
		expect(screen.getByRole("combobox")).toHaveTextContent("main");
		await user.click(screen.getByRole("combobox"));
		await user.type(
			screen.getByPlaceholderText("Search workspaces..."),
			"feat/one",
		);
		await user.click(screen.getByText("feat/one"));
		expect(screen.getByRole("combobox")).toHaveTextContent("feat/one");

		await user.click(screen.getByText("Shared prompt input"));
		expect(onSessionCreated).toHaveBeenCalledWith({ sessionId: 12 });
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("excludes the default-branch workspace from the picker list", async () => {
		const user = userEvent.setup();
		const defaultBranchWorkspace: Workspace = {
			...workspace,
			id: 3,
			branch_name: "main",
			workspace_name: "main",
			workspace_path: "/repo/.treq/main",
		};

		render(
			<AgentPromptDialog
				open
				onOpenChange={vi.fn()}
				repoPath="/repo"
				defaultBranch="main"
				workspaces={[workspace, defaultBranchWorkspace]}
				onSessionCreated={vi.fn()}
			/>,
		);

		await user.click(screen.getByRole("combobox"));
		const options = screen.getAllByRole("option");
		expect(options).toHaveLength(2);
		expect(options.map((option) => option.textContent)).toEqual([
			"main",
			"feat/one",
		]);
	});

	it("pre-fills the prompt and selects its originating workspace when initialPrompt/initialWorkspaceId are set", () => {
		render(
			<AgentPromptDialog
				open
				onOpenChange={vi.fn()}
				repoPath="/repo"
				defaultBranch="main"
				workspaces={[workspace]}
				onSessionCreated={vi.fn()}
				initialPrompt="Build the login page"
				initialWorkspaceId={workspace.id}
			/>,
		);

		expect(screen.getByRole("combobox")).toHaveTextContent("feat/one");
		expect(screen.getByTestId("task-input-initial-text")).toHaveTextContent(
			"Build the login page",
		);
	});

	it("falls back to the default branch when initialWorkspaceId has no match", () => {
		render(
			<AgentPromptDialog
				open
				onOpenChange={vi.fn()}
				repoPath="/repo"
				defaultBranch="main"
				workspaces={[workspace]}
				onSessionCreated={vi.fn()}
				initialPrompt="Some prompt"
				initialWorkspaceId={999}
			/>,
		);

		expect(screen.getByRole("combobox")).toHaveTextContent("main");
		expect(screen.getByTestId("task-input-initial-text")).toHaveTextContent(
			"Some prompt",
		);
	});
});
