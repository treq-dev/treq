import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../../test/test-utils";
import type { Workspace } from "../lib/api";
import { ShowWorkspace } from "./ShowWorkspace";

vi.mock("../lib/api", async () => {
	const actual =
		await vi.importActual<typeof import("../lib/api")>("../lib/api");
	return {
		...actual,
		getWorkspaceStatus: vi.fn().mockResolvedValue({
			conflicted_files: [],
			remote_sync: { type: "Synced" },
		}),
		listCommits: vi.fn().mockResolvedValue({ commits: [] }),
		lsWorkspace: vi.fn().mockImplementation(() => new Promise(() => {})),
		getWorkspaceReadme: vi.fn().mockImplementation(() => new Promise(() => {})),
	};
});

vi.mock("./LinearCommitHistory", () => ({ LinearCommitHistory: () => null }));

const workspace: Workspace = {
	id: 2,
	repo_path: "/repo",
	workspace_name: "workspace-2",
	workspace_path: "/repo/.treq/workspaces/workspace-2",
	branch_name: "feature-2",
	title: "Feature two",
	created_at: new Date().toISOString(),
	not_on_remote: false,
	archived: false,
};

describe("ShowWorkspace loading", () => {
	beforeEach(() => vi.clearAllMocks());

	it("shows loaded workspace chrome while slower sections keep their skeletons", () => {
		render(
			<ShowWorkspace
				repositoryPath="/repo"
				workspace={workspace}
				mainRepoBranch="main"
				initialSelectedFile={null}
			/>,
		);

		expect(screen.getByText("feature-2")).toBeTruthy();
		expect(screen.getByTestId("workspace-overview-skeleton")).toBeTruthy();
		expect(screen.getByTestId("workspace-status-skeleton")).toBeTruthy();
		expect(screen.queryByTestId("show-workspace-skeleton")).toBeNull();
	});
});
