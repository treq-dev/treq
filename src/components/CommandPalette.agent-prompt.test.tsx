import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "../../test/test-utils";
import { CommandPalette } from "./CommandPalette";

describe("CommandPalette prompted agent session", () => {
	it("offers exactly the two agent session commands", async () => {
		const user = userEvent.setup();
		const onStartAgentWithPrompt = vi.fn();
		const onStartAgentTerminal = vi.fn();

		render(
			<CommandPalette
				showCommandPalette
				onCommandPaletteChange={vi.fn()}
				workspaces={[]}
				onNavigateToDashboard={vi.fn()}
				onNavigateToSettings={vi.fn()}
				onOpenBranchSwitcher={vi.fn()}
				onOpenFilePicker={vi.fn()}
				onOpenWorkspacePicker={vi.fn()}
				onOpenWorkspaceDeletion={vi.fn()}
				onOpenArchivedWorkspaces={vi.fn()}
				onCreateStackedWorkspace={vi.fn()}
				onStartAgentWithPrompt={onStartAgentWithPrompt}
				onStartAgentTerminal={onStartAgentTerminal}
				hasSelectedWorkspace
				showBranchSwitcher={false}
				onBranchSwitcherChange={vi.fn()}
				onBranchChanged={vi.fn()}
				showWorkspaceDeletion={false}
				onWorkspaceDeletionChange={vi.fn()}
				currentWorkspace={null}
				onDeleteWorkspace={vi.fn()}
				showArchivedWorkspaces={false}
				onArchivedWorkspacesChange={vi.fn()}
				showFilePicker={false}
				onFilePickerChange={vi.fn()}
				onFileSelected={vi.fn()}
				selectedWorkspaceId={1}
				repoPath="/repo"
			/>,
		);

		await user.click(
			await screen.findByText("Start a new agent session with a prompt"),
		);

		expect(onStartAgentWithPrompt).toHaveBeenCalledOnce();
		await user.click(await screen.findByText("Start a new agent terminal"));
		expect(onStartAgentTerminal).toHaveBeenCalledOnce();
		expect(screen.queryByText("New Agent Terminal")).not.toBeInTheDocument();
		expect(screen.queryByText("New Codex Terminal")).not.toBeInTheDocument();
		expect(screen.queryByText("New Cursor Terminal")).not.toBeInTheDocument();
	});
});
