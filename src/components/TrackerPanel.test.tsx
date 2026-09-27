import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "../../test/test-utils";
import type { TrackerItem } from "../lib/api-tracker";
import { TrackerPanel } from "./TrackerPanel";

const api = vi.hoisted(() => ({
  trackerListContainers: vi.fn(),
  trackerListItems: vi.fn(),
  trackerGetViewer: vi.fn(),
  trackerOpenOrCreateWorkspaceFromItem: vi.fn(),
}));

vi.mock("../lib/api-tracker", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api-tracker")>()),
  ...api,
}));

const card: TrackerItem = {
  id: "card-1",
  key: "#12",
  title: "Add Trello integration",
  description: "Kick off workspaces from cards",
  url: "https://trello.com/c/AbC123xy",
  status: { name: "Doing", category: "in_progress" },
  labels: ["agent"],
  assignees: [{ id: "someone-else", name: "Grace" }],
  container: { id: "board-2", name: "Roadmap", key: null },
  branch_name: "trello-AbC123xy-add-trello-integration",
  parent_id: null,
  sub_item_ids: [],
};

describe("TrackerPanel", () => {
  beforeEach(() => {
    api.trackerListContainers.mockResolvedValue([
      { id: "board-2", name: "Roadmap", key: null },
      { id: "board-3", name: "Ops", key: null },
    ]);
    api.trackerListItems.mockResolvedValue([card]);
    api.trackerGetViewer.mockResolvedValue({ id: "me", name: "Me" });
    api.trackerListItems.mockClear();
    api.trackerOpenOrCreateWorkspaceFromItem.mockReset();
  });

  it("loads cards for the first Trello board and groups them by list", async () => {
    render(<TrackerPanel provider="trello" repoPath="/repo" />);

    expect(
      await screen.findByRole("heading", { name: "Doing" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Add Trello integration")).toBeInTheDocument();
    expect(screen.getByTestId("trello-container-selector")).toHaveTextContent(
      "Roadmap",
    );
    expect(api.trackerListItems).toHaveBeenCalledTimes(1);
    expect(api.trackerListItems).toHaveBeenCalledWith(
      "trello",
      "/repo",
      "board-2",
    );
  });

  it("lists every Jira project by default", async () => {
    api.trackerListContainers.mockResolvedValue([
      { id: "100", name: "Engineering", key: "ENG" },
    ]);
    render(<TrackerPanel provider="jira" repoPath="/repo" />);

    await screen.findByText("Add Trello integration");
    expect(screen.getByTestId("jira-container-selector")).toHaveTextContent(
      "All projects",
    );
    expect(api.trackerListItems).toHaveBeenCalledWith(
      "jira",
      "/repo",
      undefined,
    );
  });

  it("opens the agent prompt with the item instead of creating immediately", async () => {
    const user = userEvent.setup();
    const onStartPromptFromItem = vi.fn();
    api.trackerListItems.mockResolvedValue([
      { ...card, sub_item_ids: ["card-9"] },
    ]);
    render(
      <TrackerPanel
        provider="trello"
        repoPath="/repo"
        onStartPromptFromItem={onStartPromptFromItem}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Kick off" }));

    expect(onStartPromptFromItem).toHaveBeenCalledWith({
      provider: "trello",
      id: "card-1",
      key: "#12",
      url: "https://trello.com/c/AbC123xy",
      title: "Add Trello integration",
      includeSubItems: true,
    });
    expect(api.trackerOpenOrCreateWorkspaceFromItem).not.toHaveBeenCalled();
  });

  it("filters to the viewer's items in the Mine view", async () => {
    const user = userEvent.setup();
    api.trackerListItems.mockResolvedValue([
      card,
      {
        ...card,
        id: "card-2",
        key: "#13",
        title: "Mine to do",
        assignees: [{ id: "me", name: "Me" }],
      },
    ]);
    render(<TrackerPanel provider="trello" repoPath="/repo" />);

    await screen.findByText("Add Trello integration");
    await user.click(screen.getByRole("tab", { name: "Mine" }));

    expect(screen.getByText("Mine to do")).toBeInTheDocument();
    expect(screen.queryByText("Add Trello integration")).toBeNull();
  });

  it("shows the backend error when credentials are missing", async () => {
    api.trackerListContainers.mockRejectedValue(
      "Trello is not configured. Add an API key and token in Settings > Integrations.",
    );
    render(<TrackerPanel provider="trello" repoPath="/repo" />);

    expect(
      await screen.findByText(/Trello is not configured/),
    ).toBeInTheDocument();
  });
});
