import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { createTestRepo, openRepo } from "../../../test/utils";
import { render, screen, waitFor, within } from "../../../test/test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import { setRepoSetting, setSetting } from "../../../src/lib/api";
import { captureDocument } from "../capture";

const PROMPT = "Add input validation to the signup form";

// A session started from the "Start a new agent session" dialog must pick up
// the repo's default model (over the app default), same as one started from
// the sidebar. A fake `claude` binary on PATH stands in for the real agent.
it("starts a prompt-dialog session on the repo default model", async () => {
	const fakeAgentDir = mkdtempSync(join(tmpdir(), "treq-agent-model-"));
	const fakeAgentPath = join(fakeAgentDir, "claude");
	writeFileSync(fakeAgentPath, "#!/bin/sh\nprintf 'agent started\\n'\nsleep 5\n");
	chmodSync(fakeAgentPath, 0o755);
	const originalPath = process.env.PATH;
	process.env.PATH = `${fakeAgentDir}:${originalPath ?? ""}`;

	try {
		const { repoPath } = createTestRepo(false);
		openRepo(repoPath);
		await setSetting("default_model", "sonnet");
		await setRepoSetting(repoPath, "default_model", "opus");

		const user = userEvent.setup();
		render(<Dashboard />);
		await screen.findByTestId("show-workspace-header");

		await user.keyboard("{Meta>}i{/Meta}");
		const dialog = (
			await screen.findByRole("heading", { name: "Start a new agent session" })
		).closest('[data-testid="modal"]') as HTMLElement;
		await user.type(
			within(dialog).getByPlaceholderText("Describe a task..."),
			PROMPT,
		);
		await user.click(within(dialog).getByRole("button", { name: /^edit$/i }));

		await waitFor(() =>
			expect(
				document.querySelector('[data-terminal-id^="claude-"]'),
			).not.toBeNull(),
		);
		await screen.findByRole("button", { name: /opus/i });

		await captureDocument(document, {
			name: "agent-session-default-model-01-opus",
			expectations: [
				`An agent terminal pane is open with a tab titled "${PROMPT}".`,
				"The model selector at the right of the terminal header reads 'Opus' (the repo default), not 'Default' or 'Sonnet'.",
			],
		});
	} finally {
		process.env.PATH = originalPath;
	}
}, 120000);
