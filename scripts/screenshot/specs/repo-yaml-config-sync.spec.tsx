import * as React from "react";
import { expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { createTestRepo, openRepo, writeRepoFile } from "../../../test/utils";
import { render, screen } from "../../../test/test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import { captureDocument } from "../capture";

it("captures the YAML config section with no file, synced from a file, and after a reload", async () => {
	const { repoPath } = createTestRepo(false);
	openRepo(repoPath);

	const user = userEvent.setup();
	render(<Dashboard />);

	await user.click(await screen.findByLabelText("Settings"));
	await screen.findByRole("tab", { name: /repository/i, selected: true });

	await screen.findByText(/no \.treq\/config\.yaml found/i);

	await captureDocument(document, {
		name: "repo-yaml-config-sync-01-no-file",
		expectations: [
			"The Repository tab shows a 'YAML Configuration' section with a Reload button.",
			"The section reads 'No .treq/config.yaml found in this repository.'",
		],
	});

	await user.click(screen.getByRole("button", { name: /^close$/i }));

	await writeRepoFile(
		repoPath,
		".treq/config.yaml",
		["target_branch: main", "default_model: opus", "default_agent: claude"].join(
			"\n",
		),
	);

	await user.click(await screen.findByLabelText("Settings"));
	await screen.findByRole("tab", { name: /repository/i, selected: true });

	await screen.findByText(/synced from \.treq\/config\.yaml/i);
	await screen.findByText("opus");

	await captureDocument(document, {
		name: "repo-yaml-config-sync-02-synced-from-file",
		expectations: [
			"The YAML Configuration section shows 'Synced from .treq/config.yaml'.",
			"Target Branch, Default Model, and Default Agent rows show main, opus, and claude respectively.",
		],
		scrollIntoView: '[data-testid="repo-yaml-config-section"]',
	});

	const modelSelect = await screen.findByLabelText(/claude code model/i);
	expect(modelSelect).toBeDisabled();
	const agentSelect = screen.getByLabelText(/default agent/i);
	expect(agentSelect).toBeDisabled();
	const branchPatternInput = screen.getByLabelText(/branch name pattern/i);
	expect(branchPatternInput).not.toBeDisabled();

	await captureDocument(document, {
		name: "repo-yaml-config-sync-04-form-inputs-disabled",
		expectations: [
			"The Claude Code Model and Default Agent select fields are visibly disabled (greyed out cursor/background) and each shows a note below it reading 'Configured by .treq/config.yaml — edit the file to change this value.'",
			"The Branch Name Pattern field above them remains enabled (not greyed out) and shows its normal helper text, since branch_name_pattern is not set in the YAML file.",
		],
		scrollIntoView: "#repo-default-agent",
	});

	await writeRepoFile(repoPath, ".treq/config.yaml", "target_branch: develop\n");

	await user.click(screen.getByRole("button", { name: /reload/i }));
	await screen.findByText("develop");

	await captureDocument(document, {
		name: "repo-yaml-config-sync-03-after-reload",
		expectations: [
			"The Target Branch row now shows 'develop' instead of 'main' after clicking Reload.",
			"The Default Model and Default Agent rows for opus and claude are no longer shown, since the reloaded file only sets target_branch.",
		],
		scrollIntoView: '[data-testid="repo-yaml-config-section"]',
	});
}, 60000);
