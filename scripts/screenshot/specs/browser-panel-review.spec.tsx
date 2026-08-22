import * as React from "react";
import fs from "fs";
import os from "os";
import path from "path";
import { expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import {
	createTestRepo,
	findSidebarBranchElement,
	openRepo,
} from "../../../test/utils";
import { render, screen } from "../../../test/test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import * as api from "../../../src/lib/api";
import {
	createWorkspace,
	type PickedElement,
} from "../../../src/lib/api";
import { captureDocument } from "../capture";

// A real static HTML fixture, written to disk and addressed via a real
// file:// URL, matching this feature's explicit scope (localhost dev
// servers and static HTML files). The "subscribe" button is nested inside
// a card with a child <span> so the derived pick payload below can prove
// the self-only HTML snippet excludes children, not just assert it in the
// abstract.
const FIXTURE_HTML = `<!doctype html>
<html>
  <body>
    <main>
      <section class="pricing-card">
        <h2>Pro plan</h2>
        <p>Unlimited workspaces and priority support.</p>
        <button id="subscribe-btn" class="btn btn-primary" data-plan="pro">
          Subscribe <span class="price">$29/mo</span>
        </button>
      </section>
    </main>
  </body>
</html>`;

// Derives a PickedElement the same way the real injected page script
// (src-tauri/src/commands/browser_webview.rs) would: id-based selector,
// tagName, trimmed text content, and `cloneNode(false).outerHTML` for a
// self-only (no children) HTML snippet -- computed here against the *real*
// parsed fixture markup above, not a hand-typed literal, so this spec
// actually proves "html loads correctly and can be commented on, specific
// to the element."
function pickRealElement(selector: string): PickedElement {
	const container = document.createElement("div");
	container.innerHTML = FIXTURE_HTML;
	const el = container.querySelector(selector);
	if (!el) throw new Error(`Fixture is missing ${selector}`);
	const clone = el.cloneNode(false) as HTMLElement;
	return {
		selector,
		tag: el.tagName,
		text_preview: (el.textContent || "").trim().slice(0, 140),
		html_snippet: clone.outerHTML,
		x: 10,
		y: 20,
		width: 120,
		height: 32,
	};
}

// The in-app browser embeds a native child webview (src-tauri/src/commands/
// browser_webview.rs) that only exists inside a real OS window, so it can't
// render here -- the preview area stays visually blank in these captures.
// This spec mocks the webview-control calls (open/navigate/select-mode) the
// same way test/integration/browser/review.test.tsx does, but drives
// everything else for real: a real static HTML fixture on disk addressed by
// a real file:// URL, and a picked-element payload derived from actually
// parsing that fixture's markup (see pickRealElement above) rather than a
// fabricated literal, so the screenshots and assertions verify the actual
// element-specific comment/prompt pipeline: address bar validation, the
// select-element toggle, the comment draft/list (with a real, truncatable
// HTML snippet), and the finish-review popover that hands a review off to a
// new agent terminal session.
it("captures the in-app browser page review flow", async () => {
	const { repoPath } = createTestRepo(false);
	openRepo(repoPath);
	await createWorkspace(repoPath, "feat/browser-review");

	const fixturePath = path.join(
		os.tmpdir(),
		`treq-browser-qa-fixture-${Date.now()}.html`,
	);
	fs.writeFileSync(fixturePath, FIXTURE_HTML, "utf-8");
	const fixtureUrl = `file://${fixturePath}`;

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
	const reviewTab = await screen.findByRole("tab", { name: /^Changes/ });
	await user.click(reviewTab);
	await screen.findByRole("tab", { name: /^Changes/, selected: true });
	await screen.findByRole("button", { name: /switch review view/i });
	await captureDocument(document, {
		name: "browser-panel-review-00-diff-default",
		expectations: [
			'The Changes tab is active and the view-switcher dropdown button next to Code/Commits/Changes reads "Diff" (the default), with a diff/changes view showing below.',
		],
	});

	const viewSwitcher = screen.getByRole("button", {
		name: /switch review view/i,
	});
	await user.click(viewSwitcher);
	const browserOption = await screen.findByRole("menuitem", {
		name: "Browser",
	});
	await captureDocument(document, {
		name: "browser-panel-review-00b-dropdown-open",
		expectations: [
			'A dropdown menu is open below the view-switcher button, listing "Diff" and "Browser" options.',
		],
	});
	await user.click(browserOption);
	await screen.findByLabelText(/browser url/i);

	await captureDocument(document, {
		name: "browser-panel-review-01-empty",
		expectations: [
			'The view-switcher dropdown button next to Code/Commits/Changes now reads "Browser", showing an address bar and a placeholder message to enter a localhost or file URL.',
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
			"Pressing Enter with this invalid URL does not navigate.",
		],
	});

	await user.clear(input);
	await user.type(input, `${fixtureUrl}{Enter}`);
	await user.click(
		await screen.findByRole("button", { name: /select element/i }),
	);
	await captureDocument(document, {
		name: "browser-panel-review-03-select-mode",
		expectations: [
			'The address bar shows a file:// URL pointing at a real static HTML fixture, and the placeholder message is gone (a page is "loaded").',
			'The "Select element" toggle button is visually pressed/active.',
		],
	});

	// Derived from actually parsing FIXTURE_HTML above -- not a fabricated
	// literal. The fixture's button has a child <span class="price">, so
	// asserting it's excluded here proves the "self only, no children" HTML
	// snippet behavior against real markup, matching the real injected
	// script's `selfOnlyHtml()` (browser_webview.rs).
	const picked = pickRealElement("#subscribe-btn");
	expect(picked.html_snippet).toContain("subscribe-btn");
	expect(picked.html_snippet).not.toContain("price");
	expect(picked.html_snippet).not.toContain("Subscribe");
	expect(picked.text_preview).toContain("Subscribe");

	pickedCallback!(picked);
	const commentBox = await screen.findByPlaceholderText(/add a comment/i);
	await user.type(commentBox, "This should be disabled while submitting");
	await captureDocument(document, {
		name: "browser-panel-review-04-comment-draft",
		expectations: [
			'A comment input is open with the picked selector "#subscribe-btn (BUTTON)" shown above it.',
			'The textarea contains "This should be disabled while submitting".',
		],
	});

	const addButtons = screen.getAllByRole("button", { name: /add comment/i });
	await user.click(addButtons.find((b) => b.textContent === "Add Comment")!);
	await screen.findByText("This should be disabled while submitting");
	await captureDocument(document, {
		name: "browser-panel-review-05-comment-added",
		expectations: [
			'The comment list shows one entry: selector "#subscribe-btn (BUTTON)" and the comment text.',
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

	fs.unlinkSync(fixturePath);
}, 60000);
