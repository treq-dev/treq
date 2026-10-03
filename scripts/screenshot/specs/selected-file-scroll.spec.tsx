import * as React from "react";
import { expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import {
	createTestRepo,
	openRepo,
	resolveWorkspacePath,
	writeWorkspaceFile,
} from "../../../test/utils";
import { render, screen, waitFor, within } from "../../../test/test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import { getWorkspaces } from "../../../src/lib/api";
import { captureDocument } from "../capture";

const BRANCH_NAME = "feat/selected-file-scroll";
const LAST_FILE = "file-08.txt";
const LAST_FILE_ID = "file-section-file-08-txt";

function fileSectionSelector(path: string) {
	return `#file-section-${path.replace(/[^a-zA-Z0-9]/g, "-")}`;
}

async function clickFileInSection(
	user: ReturnType<typeof userEvent.setup>,
	sectionName: "Changes" | "Selected",
	filePath: string,
) {
	const sectionToggle = await screen.findByRole("button", {
		name: new RegExp(`^${sectionName}`),
	});
	const section = sectionToggle.closest("div")?.parentElement;
	if (!section) throw new Error(`${sectionName} section missing`);
	await user.click(await within(section).findByTitle(filePath));
}

it("scrolls the Review collapsible when clicking Changes and Selected files", async () => {
	const { repoPath } = createTestRepo(false);
	openRepo(repoPath);

	const user = userEvent.setup();
	render(<Dashboard />);

	await screen.findByTestId("show-workspace-header");
	await user.click(await screen.findByRole("button", { name: "Stack" }));
	const dialog = await screen.findByTestId("modal");
	await user.type(within(dialog).getByLabelText("Branch Name"), BRANCH_NAME);
	await user.click(
		within(dialog).getByRole("button", { name: "Create Workspace" }),
	);
	await waitFor(() => {
		expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
	});

	const workspace = (await getWorkspaces(repoPath)).find(
		(candidate) => candidate.branch_name === BRANCH_NAME,
	);
	if (!workspace) {
		throw new Error(`Expected ${BRANCH_NAME} workspace to exist`);
	}

	const workspaceDir = resolveWorkspacePath(
		repoPath,
		workspace.workspace_path,
	);
	for (let i = 1; i <= 8; i++) {
		const n = String(i).padStart(2, "0");
		writeWorkspaceFile(
			workspaceDir,
			`file-${n}.txt`,
			Array.from({ length: 12 }, (_, line) => `file ${n} line ${line + 1}`).join(
				"\n",
			) + "\n",
		);
	}

	await user.click(await screen.findByRole("tab", { name: /^Changes/ }));
	await screen.findAllByText(LAST_FILE);

	const scrolledIds: string[] = [];
	vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(
		function scrollIntoViewMock(this: Element) {
			scrolledIds.push((this as HTMLElement).id);
		},
	);

	await captureDocument(document, {
		name: "selected-file-scroll-01-before-click",
		viewport: { width: 1440, height: 700 },
		expectations: [
			"The Changes sidebar Changes list shows many files starting with file-01.txt.",
			"The main pane shows the file-01.txt collapsible near the top.",
			"file-08.txt is not the file collapsible at the top of the main pane.",
		],
	});

	scrolledIds.length = 0;
	await clickFileInSection(user, "Changes", LAST_FILE);
	await waitFor(() => {
		expect(scrolledIds).toContain(LAST_FILE_ID);
	});

	await captureDocument(document, {
		name: "selected-file-scroll-02-after-changes-click",
		viewport: { width: 1440, height: 700 },
		scrollIntoView: fileSectionSelector(LAST_FILE),
		expectations: [
			"file-08.txt is highlighted in the Changes sidebar list.",
			"The main pane is scrolled so the file-08.txt collapsible is visible.",
			"The file-08.txt collapsible header and its diff lines are readable.",
		],
	});

	const stageButton = await screen.findByTitle("Stage file(s) for commit");
	await user.click(stageButton);
	await screen.findByRole("button", { name: /^Selected/ });

	scrolledIds.length = 0;
	await clickFileInSection(user, "Selected", LAST_FILE);
	await waitFor(() => {
		expect(scrolledIds).toContain(LAST_FILE_ID);
	});

	await captureDocument(document, {
		name: "selected-file-scroll-03-after-selected-click",
		viewport: { width: 1440, height: 700 },
		scrollIntoView: fileSectionSelector(LAST_FILE),
		expectations: [
			"The Changes sidebar has a Selected section listing file-08.txt.",
			"file-08.txt is highlighted in the Selected list.",
			"The main pane shows the file-08.txt collapsible in view.",
		],
	});
}, 60000);
