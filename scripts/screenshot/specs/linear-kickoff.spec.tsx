/**
 * Verifies the Linear "Kick off" flow from the Dashboard: Kanban view shows
 * a Kick off button per issue, and clicking it opens the agent prompt dialog
 * with the Linear issue attached as a chip.
 *
 * Linear's HTTP API is mocked at the api-linear boundary (there is no local
 * Linear server); everything else is the real Dashboard + Rust dispatch.
 */

import * as React from "react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Dashboard } from "../../../src/components/Dashboard";
import type {
  LinearIssue,
  LinearTeam,
  LinearUser,
} from "../../../src/lib/api-linear";
import { render, screen, within } from "../../../test/test-utils";
import { createTestRepo, openRepo } from "../../../test/utils";
import { captureDocument } from "../capture";

const { mockLinearListTeams, mockLinearListIssues, mockLinearGetViewer } =
  vi.hoisted(() => ({
    mockLinearListTeams: vi.fn(),
    mockLinearListIssues: vi.fn(),
    mockLinearGetViewer: vi.fn(),
  }));

vi.mock("../../../src/lib/api-linear", async () => {
  const actual = await vi.importActual<
    typeof import("../../../src/lib/api-linear")
  >("../../../src/lib/api-linear");
  return {
    ...actual,
    linearListTeams: mockLinearListTeams,
    linearListIssues: mockLinearListIssues,
    linearGetViewer: mockLinearGetViewer,
  };
});

const TEAMS: LinearTeam[] = [{ id: "team-1", key: "ENG", name: "Engineering" }];
const VIEWER: LinearUser = { id: "user-me", name: "Ty" };

const ISSUES: LinearIssue[] = [
  {
    id: "issue-1",
    identifier: "ENG-101",
    title: "Rework the ranking pipeline",
    description: "Ranking is slow.",
    state: { name: "In Progress", type: "started" },
    labels: ["backend"],
    branch_name: "eng-101",
    parent_id: null,
    sub_issue_ids: ["issue-2"],
    url: "https://linear.app/treq/issue/ENG-101",
    assignee: VIEWER,
    priority: 1,
    priority_label: "Urgent",
    project: null,
  },
  {
    id: "issue-2",
    identifier: "ENG-102",
    title: "Cache ranking features",
    description: "",
    state: { name: "In Progress", type: "started" },
    labels: [],
    branch_name: "eng-102",
    parent_id: "issue-1",
    sub_issue_ids: [],
    url: "https://linear.app/treq/issue/ENG-102",
    assignee: null,
    priority: 2,
    priority_label: "High",
    project: null,
  },
  {
    id: "issue-3",
    identifier: "ENG-103",
    title: "Investigate invoice rounding error",
    description: "",
    state: { name: "Todo", type: "unstarted" },
    labels: ["bug"],
    branch_name: "eng-103",
    parent_id: null,
    sub_issue_ids: [],
    url: "https://linear.app/treq/issue/ENG-103",
    assignee: null,
    priority: 3,
    priority_label: "Medium",
    project: null,
  },
];

it("kicks off an agent prompt from a Linear issue in Kanban view", async () => {
  const { repoPath } = createTestRepo(false);
  openRepo(repoPath);

  mockLinearListTeams.mockResolvedValue(TEAMS);
  mockLinearListIssues.mockResolvedValue(ISSUES);
  mockLinearGetViewer.mockResolvedValue(VIEWER);

  const user = userEvent.setup();
  render(<Dashboard />);

  await user.click(await screen.findByTestId("linear-sidebar-item"));
  await screen.findByText("Rework the ranking pipeline");

  await captureDocument(document, {
    name: "linear-kickoff-01-list-view",
    expectations: [
      "The Linear panel is open in List view with ENG-101 and ENG-103 as root rows.",
      "Sub-issue ENG-102 is indented under ENG-101 with a left border.",
      "No Kick off button is present on any list row.",
    ],
  });

  await user.click(screen.getByRole("tab", { name: "Kanban" }));
  await screen.findAllByRole("button", { name: "Kick off" });

  await captureDocument(document, {
    name: "linear-kickoff-02-kanban-view",
    expectations: [
      'Kanban columns "In Progress" and "Todo" are shown side by side.',
      "Each card (ENG-101, its sub-issue ENG-102, ENG-103) has a full-width Kick off button.",
    ],
  });

  const card = screen
    .getByText("Rework the ranking pipeline")
    .closest("div") as HTMLElement;
  await user.click(within(card).getByRole("button", { name: "Kick off" }));
  await screen.findByText("Start a new agent session");
  const chip = await screen.findByTestId("linear-issue-chip");
  expect(chip.textContent).toContain("ENG-101");

  await captureDocument(document, {
    name: "linear-kickoff-03-prompt-dialog",
    expectations: [
      'The "Start a new agent session" dialog is open over the Linear panel.',
      "An ENG-101 chip with a violet issue icon and a remove (x) button sits above the prompt textarea.",
    ],
  });
}, 60000);
