import * as React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestRepo, openRepo } from "../utils";
import { render, screen } from "../test-utils";
import { Dashboard } from "../../src/components/Dashboard";
import userEvent from "@testing-library/user-event";

describe("Settings integration", () => {
	let user: ReturnType<typeof userEvent.setup>;

	beforeEach(() => {
		const { repoPath } = createTestRepo(false);
		openRepo(repoPath);
		user = userEvent.setup();
	});

	it("opens settings page, switches between tabs, and saves application settings", async () => {
		render(<Dashboard />);

		const settingsButton = await screen.findByLabelText("Settings");
		await user.click(settingsButton);

		await screen.findByText("Settings");
		await screen.findByRole("button", { name: /save settings/i });

		const repositoryTab = await screen.findByRole("tab", {
			name: /repository/i,
		});
		expect(repositoryTab).toHaveAttribute("data-state", "active");

		const terminalPane = await screen.findByText(/Terminals/i);
		expect(terminalPane).not.toBeVisible();

		const applicationTab = await screen.findByRole("tab", {
			name: /application/i,
		});
		expect(screen.getByRole("tab", { name: /account/i })).toBeVisible();
		expect(screen.getByRole("tab", { name: /integrations/i })).toBeVisible();
		await user.click(applicationTab);
		await screen.findByLabelText(/theme/i);
		const fontSizeInput = await screen.findByLabelText(/font size/i);

		expect(
			screen.queryByLabelText(/branch name pattern/i),
		).not.toBeInTheDocument();

		await user.clear(fontSizeInput);
		await user.type(fontSizeInput, "17");
		await user.click(screen.getByRole("button", { name: /save settings/i }));
		await screen.findByText("Settings Saved");
		await screen.findByText(/application settings updated successfully/i);

		await user.click(repositoryTab);
		await screen.findByLabelText(/branch name pattern/i);
		await screen.findByLabelText(/claude code model/i);
		await screen.findByLabelText(/symlinked directories/i);
		expect(screen.queryByLabelText(/theme/i)).not.toBeInTheDocument();
	});

	it("saves symlinked directories setting for the repository", async () => {
		render(<Dashboard />);

		await user.click(await screen.findByLabelText("Settings"));
		const repositoryTab = await screen.findByRole("tab", {
			name: /repository/i,
		});
		await user.click(repositoryTab);

		const symlinkedDirs = await screen.findByLabelText(
			/symlinked directories/i,
		);
		await user.clear(symlinkedDirs);
		await user.type(symlinkedDirs, "node_modules\ntarget");
		await user.click(screen.getByRole("button", { name: /save settings/i }));
		await screen.findByText(
			/repository settings have been updated successfully/i,
		);

		await user.click(await screen.findByRole("tab", { name: /application/i }));
		await user.click(repositoryTab);

		expect(await screen.findByLabelText(/symlinked directories/i)).toHaveValue(
			"node_modules\ntarget",
		);
	});

	it("returns to the previous page when settings is closed", async () => {
		render(<Dashboard />);

		await user.click(await screen.findByLabelText("Settings"));
		expect(
			await screen.findByRole("heading", { name: "Settings" }),
		).toBeVisible();

		await user.click(screen.getByRole("button", { name: "Close" }));

		expect(
			screen.queryByRole("heading", { name: "Settings" }),
		).not.toBeInTheDocument();
		expect(await screen.findByText(/Terminals/i)).toBeVisible();
	});
});
