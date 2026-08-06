import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen } from "../../test/test-utils";
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

	it("lists every recorded prompt labeled by workspace", async () => {
		const api = await import("../lib/api");
		vi.mocked(api.getPromptHistory).mockResolvedValue(entries);

		render(
			<PromptHistoryModal open repoPath="/repo" onOpenChange={vi.fn()} />,
		);

		expect(await screen.findByText("Second prompt sent")).toBeTruthy();
		expect(await screen.findByText("First prompt sent")).toBeTruthy();
		expect(screen.getByText("feature-one")).toBeTruthy();
		expect(screen.getByText("Home repo")).toBeTruthy();
		expect(api.getPromptHistory).toHaveBeenCalledWith("/repo");
	});

	it("shows an empty state when no prompts exist", async () => {
		const api = await import("../lib/api");
		vi.mocked(api.getPromptHistory).mockResolvedValue([]);

		render(
			<PromptHistoryModal open repoPath="/repo" onOpenChange={vi.fn()} />,
		);

		expect(await screen.findByText("No prompts sent yet.")).toBeTruthy();
	});

	it("copies an individual prompt to the clipboard", async () => {
		const api = await import("../lib/api");
		vi.mocked(api.getPromptHistory).mockResolvedValue(entries);

		render(
			<PromptHistoryModal open repoPath="/repo" onOpenChange={vi.fn()} />,
		);
		await screen.findByText("Second prompt sent");

		// userEvent.setup() installs its own clipboard stub, so the spy must be
		// created afterwards or it gets clobbered.
		const user = userEvent.setup();
		const writeTextSpy = vi
			.spyOn(navigator.clipboard, "writeText")
			.mockResolvedValue(undefined);
		const copyButtons = await screen.findAllByRole("button", { name: /^copy$/i });
		await user.click(copyButtons[0]);

		expect(writeTextSpy).toHaveBeenCalledWith("Second prompt sent");
	});

	it("does not fetch prompt history when closed", async () => {
		const api = await import("../lib/api");
		render(
			<PromptHistoryModal open={false} repoPath="/repo" onOpenChange={vi.fn()} />,
		);
		expect(api.getPromptHistory).not.toHaveBeenCalled();
	});
});
