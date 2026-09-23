import * as React from "react";
import { it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { createTestRepo, openRepo } from "../../../test/utils";
import { render, screen } from "../../../test/test-utils";
import { SettingsPage } from "../../../src/components/SettingsPage";
import { captureDocument } from "../capture";

it("shows the Code Review settings section", async () => {
	const { repoPath } = createTestRepo(false);
	openRepo(repoPath);

	const user = userEvent.setup();
	render(<SettingsPage repoPath={repoPath} onClose={vi.fn()} />);

	await user.click(await screen.findByRole("tab", { name: /repository/i }));
	await screen.findByText(/code review/i);

	await captureDocument(document, {
		name: "agent-review-settings-01-code-review-section",
		expectations: [
			'A "Code Review" section is visible with a "Custom Review Prompt" textarea, a "Review Agent" selector, and an "Automatic Review" selector.',
			"All three controls are enabled (not grayed out/YAML-managed).",
		],
		scrollIntoView: '[data-testid="code-review-settings-section"]',
	});

	const prompt = screen.getByLabelText(/custom review prompt/i);
	await user.type(prompt, "Focus on null-safety and error handling.");

	const autoTrigger = screen.getByLabelText(
		/automatic review/i,
	) as HTMLSelectElement;
	await user.selectOptions(autoTrigger, "on-commit");

	await captureDocument(document, {
		name: "agent-review-settings-02-configured",
		expectations: [
			'The Custom Review Prompt textarea contains "Focus on null-safety and error handling."',
			'The Automatic Review selector shows "on-commit" selected.',
		],
		scrollIntoView: '[data-testid="code-review-settings-section"]',
	});
}, 60000);
