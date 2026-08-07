import * as React from "react";
import { it } from "vitest";
import userEvent from "@testing-library/user-event";
import { createTestRepo, openRepo, writeRepoFile } from "../../../test/utils";
import { render, screen, waitFor, within } from "../../../test/test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import { createWorkspace } from "../../../src/lib/api";
import { captureDocument } from "../capture";

// One workflow with a passing job and a failing job, so a single "Run All"
// shows both the green-checkmark and the red-X / fail-fast rendering.
const MIXED_WORKFLOW = `
name: Pull request checks
on:
  workflow_dispatch: {}
jobs:
  greet:
    name: Greet Job
    steps:
      - name: Say hello
        run: echo hello
      - name: Say world
        run: echo world
  verify:
    name: Verify Job
    steps:
      - name: Failing check
        run: exit 1
      - name: Never runs
        run: echo skipped
`;

it("captures the Checks tab trust gate and step pass/fail results", async () => {
	const { repoPath } = createTestRepo(false);
	openRepo(repoPath);
	// Incidental background state: the Checks tab needs a workspace to render
	// under, but workspace creation is not the behavior being verified here.
	await createWorkspace(repoPath, "feat/checks");
	await writeRepoFile(repoPath, ".treq/workflows/ci.yaml", MIXED_WORKFLOW);

	const user = userEvent.setup();
	render(<Dashboard />);

	// Navigate to the workspace, then to the Checks tab.
	const sidebar = document.querySelector(
		`.${CSS.escape("group/sidebar")}`,
	) as HTMLElement;
	await waitFor(() => {
		if (within(sidebar).queryAllByText("feat/checks").length === 0) {
			throw new Error("workspace not in sidebar yet");
		}
	});
	await user.click(within(sidebar).getAllByText("feat/checks")[0]);

	await user.click(await screen.findByRole("tab", { name: /^Checks/ }));
	await screen.findByRole("tab", { name: /^Checks/, selected: true });

	// Untrusted: the workflow is listed but execution is gated.
	await screen.findByText("Pull request checks");
	await screen.findByText("Greet Job");
	await screen.findByText("Verify Job");
	const trustButton = await screen.findByRole("button", {
		name: /Trust Repository/i,
	});
	await captureDocument(document, {
		name: "checks-tab-01-untrusted",
		expectations: [
			'An amber/yellow warning banner is visible reading "Trust this repository to enable running workflow checks." with a "Trust Repository" button on its right.',
			'The workflow card below shows the title "Pull request checks" with the filename "ci.yaml" underneath, and lists "Greet Job" and "Verify Job".',
			'All run buttons ("Run All", "Run Greet Job", "Run Verify Job") appear visually disabled/greyed out.',
			"Every step name has a grey neutral dot icon beside it — no green checkmarks and no red X icons anywhere.",
		],
	});

	// Trusting the repo removes the gate and enables execution.
	await user.click(trustButton);
	await waitFor(() => {
		if (screen.queryByRole("button", { name: /Trust Repository/i })) {
			throw new Error("trust banner still present");
		}
	});
	await captureDocument(document, {
		name: "checks-tab-02-trusted",
		expectations: [
			"The amber trust banner is completely gone from the top of the panel.",
			'The run buttons ("Run All", "Run Greet Job", "Run Verify Job") now appear enabled — normal contrast, not greyed out.',
			"Step names still show grey neutral dot icons, since nothing has been run yet.",
		],
	});

	// Run every job in the workflow.
	await user.click(await screen.findByRole("button", { name: /Run All/i }));
	await waitFor(
		() => {
			const passIcons = document.querySelectorAll(
				'[data-testid="step-result-pass"]',
			);
			const failIcons = document.querySelectorAll(
				'[data-testid="step-result-fail"]',
			);
			if (passIcons.length !== 2 || failIcons.length !== 1) {
				throw new Error(
					`expected 2 pass / 1 fail, got ${passIcons.length} / ${failIcons.length}`,
				);
			}
		},
		{ timeout: 20000 },
	);
	await captureDocument(document, {
		name: "checks-tab-03-after-run-all",
		expectations: [
			'Under "Greet Job", both "Say hello" and "Say world" have green checkmark icons.',
			'Under "Verify Job", "Failing check" has a red X icon.',
			'"Never runs" (the step after the failing one) still shows a grey neutral dot, NOT a green check or red X — it was skipped by fail-fast.',
			"There are exactly 2 green checkmarks and exactly 1 red X in the whole panel.",
		],
	});
}, 90000);
