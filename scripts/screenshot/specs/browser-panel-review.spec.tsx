import * as React from "react";
import { it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import {
	createTestRepo,
	findSidebarBranchElement,
	openRepo,
} from "../../../test/utils";
import { render, screen } from "../../../test/test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import * as api from "../../../src/lib/api";
import { createWorkspace } from "../../../src/lib/api";
import type { PickedElement } from "../../../src/lib/api-types";
import { captureDocument } from "../capture";

// The in-app browser embeds a native child webview (src-tauri/src/commands/
// browser_webview.rs) that only exists inside a real OS window, so it can't
// render here. This spec mocks the webview-control calls (open/navigate/
// select-mode) the same way test/integration/browser/review.test.tsx does,
// and simulates an "element picked" event to drive the comment flow, so the
// screenshots cover the React panel chrome: address bar validation, the
// select-element toggle, the comment draft/list, and the finish-review
// popover that hands a review off to a new agent terminal session.
it("captures the in-app browser page review flow", async () => {
	const { repoPath } = createTestRepo(false);
	openRepo(repoPath);
	await createWorkspace(repoPath, "feat/browser-review");

	let pickedCallback: ((element: PickedElement) => void) | null = null;
	vi.spyOn(api, "openBrowserWebview").mockResolvedValue(undefined);
	vi.spyOn(api, "navigateBrowserWebview").mockResolvedValue(undefined);
	vi.spyOn(api, "closeBrowserWebview").mockResolvedValue(undefined);
	vi.spyOn(api, "setBrowserSelectMode").mockResolvedValue(undefined);
	vi.spyOn(api, "syncBrowserWebviewBounds").mockResolvedValue(undefined);
	vi.spyOn(api, "listenBrowserElementPicked").mockImplementation((callback) => {
		pickedCallback = callback;
		return Promise.resolve(() => {});
	});
	vi.spyOn(api, "listenBrowserUrlChanged").mockImplementation(() =>
		Promise.resolve(() => {}),
	);

	const user = userEvent.setup();
	render(<Dashboard />);

	await user.click(await findSidebarBranchElement("feat/browser-review"));
	const browserTab = await screen.findByRole("tab", { name: /^Browser/ });
	await user.click(browserTab);
	await screen.findByRole("tab", { name: /^Browser/, selected: true });

	await captureDocument(document, {
		name: "browser-panel-review-01-empty",
		expectations: [
			"The Browser tab is active, showing an address bar and a placeholder message to enter a localhost or file URL.",
			'The "Finish review" and "Discard" buttons are visible but disabled since there are no comments yet.',
		],
	});

	const input = await screen.findByLabelText(/browser url/i);
	await user.clear(input);
	await user.type(input, "https://example.com");
	await captureDocument(document, {
		name: "browser-panel-review-02-invalid-url",
		expectations: [
			'The address bar contains "https://example.com" styled as invalid (red/destructive border) with a helper message that only localhost/127.0.0.1/file URLs are supported.',
			'The "Go" button is disabled.',
		],
	});

	await user.clear(input);
	await user.type(input, "http://localhost:3000/");
	await user.click(screen.getByRole("button", { name: /^go$/i }));
	await user.click(
		await screen.findByRole("button", { name: /select element/i }),
	);
	await captureDocument(document, {
		name: "browser-panel-review-03-select-mode",
		expectations: [
			'The address bar shows "http://localhost:3000/" and the placeholder message is gone (a page is "loaded").',
			'The "Select element" toggle button is visually pressed/active.',
		],
	});

	pickedCallback!({
		selector: "#checkout > button.primary",
		tag: "BUTTON",
		text_preview: "Place order",
		x: 10,
		y: 20,
		width: 120,
		height: 32,
	});
	const commentBox = await screen.findByPlaceholderText(/add a comment/i);
	await user.type(commentBox, "This should be disabled while submitting");
	await captureDocument(document, {
		name: "browser-panel-review-04-comment-draft",
		expectations: [
			'A comment input is open with the picked selector "#checkout > button.primary (BUTTON)" shown above it.',
			'The textarea contains "This should be disabled while submitting".',
		],
	});

	const addButtons = screen.getAllByRole("button", { name: /add comment/i });
	await user.click(addButtons.find((b) => b.textContent === "Add Comment")!);
	await screen.findByText("This should be disabled while submitting");
	await captureDocument(document, {
		name: "browser-panel-review-05-comment-added",
		expectations: [
			'The comment list shows one entry: selector "#checkout > button.primary (BUTTON)" and the comment text.',
			'The comment count reads "1 comment" and "Finish review"/"Discard" are now enabled.',
		],
	});

	await user.click(
		await screen.findByRole("button", { name: /finish review/i }),
	);
	await user.type(
		await screen.findByPlaceholderText(/add a summary comment/i),
		"Overall looks solid",
	);
	await captureDocument(document, {
		name: "browser-panel-review-06-finish-popover",
		expectations: [
			'A "Finish your page review" popover is open with a summary textarea containing "Overall looks solid".',
			'"Plan" and "Edit" buttons are visible at the bottom of the popover.',
		],
	});
}, 60000);
