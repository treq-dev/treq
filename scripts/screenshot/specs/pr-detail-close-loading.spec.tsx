/**
 * Verifies that clicking Close PR on a GitHub PR detail panel first asks for
 * confirmation, and that confirming closes the dialog and immediately shows a
 * pending "Closing…" label and spinner (gh close is stubbed so the request
 * stays in flight).
 */

import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { PrDetailPanel } from "../../../src/components/github-panel/PrDetail";
import type { GhPullRequest } from "../../../src/lib/api-types";
import { render, screen } from "../../../test/test-utils";
import { captureDocument } from "../capture";

const api = vi.hoisted(() => ({
	ghViewPr: vi.fn(),
	getPrChecksForPr: vi.fn(),
	getWorkspaces: vi.fn(),
	ghClosePr: vi.fn(),
}));

vi.mock("../../../src/lib/api", async (importOriginal) => {
	const original = await importOriginal<typeof import("../../../src/lib/api")>();
	return {
		...original,
		ghViewPr: api.ghViewPr,
		getPrChecksForPr: api.getPrChecksForPr,
		getWorkspaces: api.getWorkspaces,
		ghClosePr: api.ghClosePr,
	};
});

function openPr(): GhPullRequest {
	return {
		number: 42,
		title: "Add example module",
		state: "OPEN",
		url: "https://github.com/acme/treq/pull/42",
		body: "Ready to close.",
		author: { login: "alice" },
		labels: [],
		head_ref_name: "feat/example",
		base_ref_name: "main",
		merge_state_status: "CLEAN",
		created_at: "2026-01-01T00:00:00Z",
		updated_at: "2026-01-01T00:00:00Z",
		comments: null,
		is_draft: false,
	};
}

it("captures Close PR loading on click", async () => {
	api.ghViewPr.mockReset().mockResolvedValue(openPr());
	api.getPrChecksForPr.mockReset().mockResolvedValue(null);
	api.getWorkspaces.mockReset().mockResolvedValue([]);
	api.ghClosePr.mockReset().mockImplementation(() => new Promise(() => {}));

	const user = userEvent.setup();
	render(
		<PrDetailPanel
			repoPath="/tmp/repo"
			repoFullName="acme/treq"
			prNumber={42}
			onClose={() => {}}
		/>,
	);

	const closeButton = await screen.findByRole("button", { name: /close pr/i });
	await captureDocument(document, {
		name: "pr-detail-close-loading-01-before",
		expectations: [
			'An outline "Close PR" button is visible in the PR detail footer.',
			'The button is enabled and does not say "Closing…".',
		],
	});

	await user.click(closeButton);
	expect(await screen.findByText("Close pull request #42?")).toBeVisible();
	expect(api.ghClosePr).not.toHaveBeenCalled();

	await captureDocument(document, {
		name: "pr-detail-close-loading-02-confirm",
		expectations: [
			'A dialog titled "Close pull request #42?" is centered over the PR detail panel.',
			"The dialog explains that GitHub notifies the author and reviewers and that the PR can be reopened.",
			'The dialog footer has a "Keep open" button and a "Close pull request" button.',
		],
	});

	await user.click(screen.getByRole("button", { name: /close pull request/i }));
	expect(await screen.findByRole("button", { name: /closing/i })).toBeDisabled();
	expect(screen.queryByText("Close pull request #42?")).toBeNull();

	await captureDocument(document, {
		name: "pr-detail-close-loading-03-pending",
		expectations: [
			"The confirmation dialog is gone and the panel is not dimmed.",
			'The Close PR control now reads "Closing…" and looks disabled.',
			"A spinner is visible next to the Closing label.",
		],
	});
}, 60000);
