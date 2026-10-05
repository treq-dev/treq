import * as React from "react";
import { expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { createTestRepo, openRepo } from "../../../test/utils";
import { render, screen } from "../../../test/test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import { captureDocument } from "../capture";

it("captures the stack comments toggle defaulting on and saving off", async () => {
	const { repoPath } = createTestRepo(false);
	openRepo(repoPath);

	const user = userEvent.setup();
	render(<Dashboard />);

	await user.click(await screen.findByLabelText("Settings"));
	await screen.findByRole("tab", { name: /repository/i, selected: true });

	const toggle = await screen.findByRole("switch", {
		name: /post stack comments on pull requests/i,
	});
	expect(toggle).toHaveAttribute("aria-checked", "true");

	await captureDocument(document, {
		name: "repository-settings-stack-comments-01-default-on",
		viewport: { width: 1440, height: 1200 },
		expectations: [
			"The Repository tab shows a 'Post stack comments on pull requests' row below 'Ignore generated Treq paths'.",
			"The row's description says the comment lists the merge order and is visible to everyone on GitHub.",
			"The Post stack comments switch is in the on (checked) position.",
		],
	});

	await user.click(toggle);
	expect(toggle).toHaveAttribute("aria-checked", "false");
	await user.click(screen.getByRole("button", { name: /save settings/i }));
	await screen.findByText("Settings saved");

	await captureDocument(document, {
		name: "repository-settings-stack-comments-02-off-and-saved",
		viewport: { width: 1440, height: 1200 },
		expectations: [
			"The Post stack comments switch is in the off (unchecked) position.",
			"A 'Settings saved' toast is visible confirming the save.",
		],
	});
}, 60000);
