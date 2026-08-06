import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, within } from "../../test/test-utils";
import { PromptHistoryModal } from "./PromptHistoryModal";
import type { PromptHistoryEntry } from "../lib/api";

vi.mock("../lib/api", async () => {
	const actual =
		await vi.importActual<typeof import("../lib/api")>("../lib/api");
	return {
		...actual,
		getPromptHistory: vi.fn(),
	};
});

const entries: PromptHistoryEntry[] = [
	{
		id: 2,
		workspace_id: 7,
		session_id: 42,
		prompt_text: "Second prompt sent",
		agent: "claude",
		created_at: "2026-01-02T00:00:00.000Z",
		workspace_label: "feature-one",
	},
	{
		id: 1,
		workspace_id: null,
		session_id: 41,
		prompt_text: "First prompt sent",
		agent: null,
		created_at: "2026-01-01T00:00:00.000Z",
		workspace_label: null,
	},
];

describe("PromptHistoryModal", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("lists every recorded prompt in the left pane, labeled by workspace", async () => {
		const api = await import("../lib/api");
		vi.mocked(api.getPromptHistory).mockResolvedValue(entries);

		render(
			<PromptHistoryModal open repoPath="/repo" onOpenChange={vi.fn()} />,
		);

		const list = await screen.findByTestId("prompt-history-list");
		expect(within(list).getByText("Second prompt sent")).toBeTruthy();
		expect(within(list).getByText("First prompt sent")).toBeTruthy();
		expect(within(list).getByText("feature-one")).toBeTruthy();
		expect(within(list).getByText("Home repo")).toBeTruthy();
		expect(api.getPromptHistory).toHaveBeenCalledWith("/repo");
	});

	it("shows the most recent prompt in the detail pane by default", async () => {
		const api = await import("../lib/api");
		vi.mocked(api.getPromptHistory).mockResolvedValue(entries);

		render(
			<PromptHistoryModal open repoPath="/repo" onOpenChange={vi.fn()} />,
		);

		expect(
			await screen.findByTestId("prompt-history-detail-text"),
		).toHaveTextContent("Second prompt sent");
	});

	it("switches the detail pane when a different list entry is clicked", async () => {
		const api = await import("../lib/api");
		vi.mocked(api.getPromptHistory).mockResolvedValue(entries);

		render(
			<PromptHistoryModal open repoPath="/repo" onOpenChange={vi.fn()} />,
		);
		const list = await screen.findByTestId("prompt-history-list");
		await within(list).findByText("Second prompt sent");

		const user = userEvent.setup();
		await user.click(within(list).getByText("First prompt sent"));

		expect(
			await screen.findByTestId("prompt-history-detail-text"),
		).toHaveTextContent("First prompt sent");
	});

	it("pre-selects the entry passed via initialSelectedId", async () => {
		const api = await import("../lib/api");
		vi.mocked(api.getPromptHistory).mockResolvedValue(entries);

		render(
			<PromptHistoryModal
				open
				repoPath="/repo"
				onOpenChange={vi.fn()}
				initialSelectedId={1}
			/>,
		);

		expect(
			await screen.findByTestId("prompt-history-detail-text"),
		).toHaveTextContent("First prompt sent");
	});

	it("shows an empty state when no prompts exist", async () => {
		const api = await import("../lib/api");
		vi.mocked(api.getPromptHistory).mockResolvedValue([]);

		render(
			<PromptHistoryModal open repoPath="/repo" onOpenChange={vi.fn()} />,
		);

		expect(await screen.findByText("No prompts sent yet.")).toBeTruthy();
	});

	it("copies the selected prompt to the clipboard", async () => {
		const api = await import("../lib/api");
		vi.mocked(api.getPromptHistory).mockResolvedValue(entries);

		render(
			<PromptHistoryModal open repoPath="/repo" onOpenChange={vi.fn()} />,
		);
		await screen.findByTestId("prompt-history-detail-text");

		// userEvent.setup() installs its own clipboard stub, so the spy must be
		// created afterwards or it gets clobbered.
		const user = userEvent.setup();
		const writeTextSpy = vi
			.spyOn(navigator.clipboard, "writeText")
			.mockResolvedValue(undefined);
		await user.click(await screen.findByRole("button", { name: /^copy$/i }));

		expect(writeTextSpy).toHaveBeenCalledWith("Second prompt sent");
	});

	it("calls onRunPrompt with the selected entry's text and workspace id", async () => {
		const api = await import("../lib/api");
		vi.mocked(api.getPromptHistory).mockResolvedValue(entries);
		const onRunPrompt = vi.fn();

		render(
			<PromptHistoryModal
				open
				repoPath="/repo"
				onOpenChange={vi.fn()}
				onRunPrompt={onRunPrompt}
			/>,
		);
		await screen.findByTestId("prompt-history-detail-text");

		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: /run prompt/i }));

		expect(onRunPrompt).toHaveBeenCalledWith("Second prompt sent", 7);
	});

	it("does not show a Run prompt button when onRunPrompt is not provided", async () => {
		const api = await import("../lib/api");
		vi.mocked(api.getPromptHistory).mockResolvedValue(entries);

		render(
			<PromptHistoryModal open repoPath="/repo" onOpenChange={vi.fn()} />,
		);
		await screen.findByTestId("prompt-history-detail-text");

		expect(
			screen.queryByRole("button", { name: /run prompt/i }),
		).not.toBeInTheDocument();
	});

	it("does not fetch prompt history when closed", async () => {
		const api = await import("../lib/api");
		render(
			<PromptHistoryModal open={false} repoPath="/repo" onOpenChange={vi.fn()} />,
		);
		expect(api.getPromptHistory).not.toHaveBeenCalled();
	});
});
