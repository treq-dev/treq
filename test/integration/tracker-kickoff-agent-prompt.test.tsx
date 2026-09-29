// @include-parallel
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "../../src/components/Dashboard";
import type { TrackerItem } from "../../src/lib/api-tracker";
import { createWorkspace } from "../../src/lib/api";
import { render, screen, within } from "../test-utils";
import { createTestRepo, findSidebarBranchElement, openRepo } from "../utils";

const trackerApi = vi.hoisted(() => ({
  trackerListContainers: vi.fn(),
  trackerListItems: vi.fn(),
  trackerGetViewer: vi.fn(),
  trackerOpenOrCreateWorkspaceFromItem: vi.fn(),
}));

vi.mock("../../src/lib/api-tracker", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/api-tracker")>()),
  ...trackerApi,
}));

const issue: TrackerItem = {
  id: "ENG-42",
  key: "ENG-42",
  title: "Add Jira integration",
  description: "Mirror the Linear kickoff flow",
  url: "https://acme.atlassian.net/browse/ENG-42",
  status: { name: "To Do", category: "todo" },
  labels: [],
  assignees: [],
  container: { id: "100", name: "Engineering", key: "ENG" },
  branch_name: "ENG-42-add-jira-integration",
  parent_id: null,
  sub_item_ids: [],
};

describe("Jira issue kickoff", () => {
  let user: ReturnType<typeof userEvent.setup>;
  let repoPath: string;

  beforeEach(() => {
    ({ repoPath } = createTestRepo(false));
    openRepo(repoPath);
    user = userEvent.setup();
    trackerApi.trackerListContainers.mockResolvedValue([issue.container]);
    trackerApi.trackerListItems.mockResolvedValue([issue]);
    trackerApi.trackerGetViewer.mockResolvedValue({ id: "me", name: "Me" });
  });

  it("opens the agent prompt dialog with the Jira issue attached", async () => {
    render(<Dashboard />);

    await user.click(await screen.findByTestId("jira-sidebar-item"));
    await user.click(await screen.findByRole("button", { name: "Kick off" }));

    const dialog = (
      await screen.findByRole("heading", { name: "Start a new agent session" })
    ).closest('[data-testid="modal"]') as HTMLElement;
    const chip = await within(dialog).findByTestId("issue-chip");
    expect(chip).toHaveTextContent("Jira ENG-42");
    expect(
      within(dialog).getByText(/Opens a workspace for ENG-42/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /^edit$/i }),
    ).toBeEnabled();
  }, 60000);

  it("lists the Jira issue's new workspace in the sidebar after submit", async () => {
    trackerApi.trackerOpenOrCreateWorkspaceFromItem.mockImplementation(
      async (path: string) => {
        const workspaceId = await createWorkspace(path, issue.branch_name);
        return [
          { item_id: issue.id, workspace_id: workspaceId, created: true },
        ];
      },
    );
    render(<Dashboard />);

    await user.click(await screen.findByTestId("jira-sidebar-item"));
    await user.click(await screen.findByRole("button", { name: "Kick off" }));
    const dialog = (
      await screen.findByRole("heading", { name: "Start a new agent session" })
    ).closest('[data-testid="modal"]') as HTMLElement;
    await user.click(within(dialog).getByRole("button", { name: /^edit$/i }));

    expect(
      trackerApi.trackerOpenOrCreateWorkspaceFromItem,
    ).toHaveBeenCalledWith(repoPath, {
      provider: "jira",
      id: issue.id,
      includeSubItems: false,
    });
    expect(await findSidebarBranchElement(issue.branch_name)).toBeTruthy();
  }, 60000);
});
