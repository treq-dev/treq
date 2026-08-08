import { describe, expect, it } from "vitest";
import { appendAgentPrompt, treqAgentSystemPrompt } from "./agentCommand";

describe("appendAgentPrompt", () => {
	it("separates a prompt beginning with hyphens from CLI options", () => {
		expect(
			appendAgentPrompt(
				"codex -c 'instructions=treq'",
				"---- test failure ----",
			),
		).toBe("codex -c 'instructions=treq' -- '---- test failure ----'");
	});

	it("quotes shell metacharacters in the prompt", () => {
		expect(appendAgentPrompt("codex", "it's $HOME `pwd`!")).toBe(
			"codex -- 'it'\\''s $HOME `pwd`!'",
		);
	});
});

describe("treqAgentSystemPrompt", () => {
	it("allows treq CLI commands that create workspaces outside the working directory", () => {
		expect(treqAgentSystemPrompt).toContain(
			"You may run treq CLI commands even when they create or manage workspaces outside the current working directory.",
		);
	});

	it("still scopes direct file edits to the working directory", () => {
		expect(treqAgentSystemPrompt).toContain(
			"When editing files directly, you must read, write, edit, and delete only files in the current working directory.",
		);
	});
});
