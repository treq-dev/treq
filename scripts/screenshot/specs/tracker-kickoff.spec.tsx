/**
 * Verifies the Trello and Jira kickoff flow from the Dashboard: the tracker
 * panel lists items grouped by status, "Kick off" opens the agent prompt with
 * the item attached. Also captures the Jira settings section under Settings > Integrations.
 *
 * The tracker HTTP APIs are mocked at the api-tracker boundary; everything
 * else is the real Dashboard + Rust dispatch.
 */

import * as React from "react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Dashboard } from "../../../src/components/Dashboard";
import type { TrackerItem } from "../../../src/lib/api-tracker";
import { render, screen, within } from "../../../test/test-utils";
import { createTestRepo, openRepo } from "../../../test/utils";
import { captureDocument } from "../capture";

const trackerApi = vi.hoisted(() => ({
  trackerListContainers: vi.fn(),
  trackerListItems: vi.fn(),
  trackerGetViewer: vi.fn(),
  trackerOpenOrCreateWorkspaceFromItem: vi.fn(),
}));

vi.mock("../../../src/lib/api-tracker", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/lib/api-tracker")>()),
  ...trackerApi,
}));

const BOARD = { id: "board-1", name: "Product Roadmap", key: null };

const card = (overrides: Partial<TrackerItem>): TrackerItem => ({
  id: "card-1",
  key: "#12",
  title: "Add Trello integration",
  description: "Kick off workspaces straight from a card.",
  url: "https://trello.com/c/AbC123xy",
  status: { name: "Doing", category: "in_progress" },
  labels: ["agent"],
  assignees: [{ id: "me", name: "Ty" }],
  container: BOARD,
  branch_name: "trello-AbC123xy-add-trello-integration",
  parent_id: null,
  sub_item_ids: [],
  ...overrides,
});

const CARDS: TrackerItem[] = [
  card({}),
  card({
    id: "card-2",
    key: "#13",
    title: "Polish onboarding copy",
    description: null,
    labels: ["design"],
    assignees: [],
  }),
  card({
    id: "card-3",
    key: "#14",
    title: "Fix invoice rounding",
    description: "Totals drift by one cent on multi-currency orders.",
    status: { name: "To Do", category: "todo" },
    labels: ["bug"],
    assignees: [{ id: "grace", name: "Grace" }],
  }),
];

it("kicks off an agent prompt from a Trello card", async () => {
  const { repoPath } = createTestRepo(false);
  openRepo(repoPath);
  trackerApi.trackerListContainers.mockResolvedValue([BOARD]);
  trackerApi.trackerListItems.mockResolvedValue(CARDS);
  trackerApi.trackerGetViewer.mockResolvedValue({ id: "me", name: "Ty" });

  const user = userEvent.setup();
  render(<Dashboard />);

  await user.click(await screen.findByTestId("trello-sidebar-item"));
  await screen.findByText("Add Trello integration");
  await captureDocument(document, {
    name: "tracker-kickoff-01-trello-panel",
    expectations: [
      "The main pane shows a Trello panel with the 'Product Roadmap' board selected at the top right.",
      "Cards are grouped under 'Doing' (2) and 'To Do' (1) headings, each row with a key, title, labels, and a 'Kick off' button, and no repeated board chip.",
      "The sidebar shows a highlighted 'Trello' entry below 'Linear' and above 'Jira'.",
    ],
  });

  const [firstKickoff] = await screen.findAllByRole("button", {
    name: "Kick off",
  });
  await user.click(firstKickoff!);
  const dialog = (
    await screen.findByRole("heading", { name: "Start a new agent session" })
  ).closest('[data-testid="modal"]') as HTMLElement;
  expect(within(dialog).getByTestId("issue-chip")).toHaveTextContent(
    "Trello #12",
  );
  await captureDocument(document, {
    name: "tracker-kickoff-02-prompt-dialog",
    expectations: [
      "A 'Start a new agent session' dialog is open with the line 'Opens a workspace for #12' instead of a workspace picker.",
      "The prompt box shows a 'Trello #12' chip with a remove (x) button above the textarea.",
    ],
  });
}, 90000);

// The workspace header badge (data-testid "tracker-item-badge") reads
// metadata that only the Rust kickoff writes, so it is covered by
// ShowWorkspace.workspace-details.test.tsx and
// core::workspaces::merge_tracker_item_metadata_preserves_linear_fields.

it("shows the Jira settings section under Integrations", async () => {
  const { repoPath } = createTestRepo(false);
  openRepo(repoPath);
  trackerApi.trackerListContainers.mockResolvedValue([]);
  trackerApi.trackerListItems.mockResolvedValue([]);
  trackerApi.trackerGetViewer.mockResolvedValue({ id: "me", name: "Ty" });

  const user = userEvent.setup();
  render(<Dashboard />);

  await user.click(await screen.findByRole("button", { name: /settings/i }));
  await user.click(await screen.findByRole("tab", { name: /integrations/i }));
  const section = await screen.findByTestId("jira-integration-settings");
  await user.click(
    within(section).getByRole("button", { name: "Add Jira Site URL" }),
  );
  await user.type(
    within(section).getByLabelText("Jira Site URL"),
    "acme.atlassian.net",
  );
  await captureDocument(document, {
    name: "tracker-kickoff-03-jira-settings",
    viewport: { width: 1440, height: 1600 },
    clipSelector: '[data-testid="jira-integration-settings"]',
    expectations: [
      "The Jira section has a title row with a ticket icon and one row per setting.",
      "The Jira 'Site URL' row is in edit mode with 'acme.atlassian.net' typed into the input plus Save and Cancel buttons.",
      "The other Jira rows (Email, API token, Issue query (JQL), Auto-kickoff label) show an 'Add' button.",
    ],
  });
}, 90000);
