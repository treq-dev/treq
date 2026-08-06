import * as React from "react";
import { expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { createTestRepo, openRepo } from "../../../test/utils";
import { render, screen } from "../../../test/test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import { captureDocument } from "../capture";

it("captures symlinked directories repository setting", async () => {
	const { repoPath } = createTestRepo(false);
	openRepo(repoPath);

	const user = userEvent.setup();
	render(<Dashboard />);

	await user.click(await screen.findByLabelText("Settings"));
	const repositoryTab = await screen.findByRole("tab", {
		name: /repository/i,
	});
	expect(repositoryTab).toHaveAttribute("data-state", "active");
	await screen.findByLabelText(/symlinked directories/i);

	await captureDocument(document, {
		name: "symlinked-dirs-settings-01-empty",
		expectations: [
			"The Repository settings tab is active.",
			"A Symlinked Directories textarea is visible below Included Files.",
			"Helper text mentions node_modules, target, or .venv.",
		],
	});

	const symlinkedDirs = await screen.findByLabelText(/symlinked directories/i);
	await user.clear(symlinkedDirs);
	await user.type(symlinkedDirs, "node_modules\ntarget");
	await user.click(screen.getByRole("button", { name: /save settings/i }));
	await screen.findByText(
		/repository settings have been updated successfully/i,
	);

	await captureDocument(document, {
		name: "symlinked-dirs-settings-02-saved",
		expectations: [
			"The Symlinked Directories field shows node_modules and target.",
			"A success toast confirms repository settings were saved.",
		],
	});
}, 60000);
