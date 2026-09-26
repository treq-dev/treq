/**
 * Verifies the Linear panel's standard-view subtabs, AND-combined issue
 * filters (assignee/priority/label/project), and the new Projects tab with
 * its dual-column project list + detail (including document viewing).
 */

import userEvent from "@testing-library/user-event";
import { it, vi } from "vitest";
import { LinearPanel } from "../../../src/components/LinearPanel";
import type {
  LinearComment,
  LinearDocument,
  LinearIssue,
  LinearProject,
  LinearTeam,
  LinearUser,
} from "../../../src/lib/api-linear";
import { render, screen, waitFor, within } from "../../../test/test-utils";
import { createTestRepo } from "../../../test/utils";
import { captureDocument } from "../capture";

/** Waits for a nested Radix dropdown submenu to mount alongside its parent menu. */
async function waitForMenuCount(count: number): Promise<HTMLElement[]> {
  return waitFor(() => {
    const menus = screen.getAllByRole("menu");
    if (menus.length < count) throw new Error("submenu not open yet");
    return menus;
  });
}

const {
  mockLinearListTeams,
  mockLinearListIssues,
  mockLinearGetViewer,
  mockLinearListProjects,
  mockLinearListProjectDocuments,
  mockLinearListIssueComments,
  mockLinearListProjectComments,
  mockLinearListDocumentComments,
} = vi.hoisted(() => ({
  mockLinearListTeams: vi.fn(),
  mockLinearListIssues: vi.fn(),
  mockLinearGetViewer: vi.fn(),
  mockLinearListProjects: vi.fn(),
  mockLinearListProjectDocuments: vi.fn(),
  mockLinearListIssueComments: vi.fn(),
  mockLinearListProjectComments: vi.fn(),
  mockLinearListDocumentComments: vi.fn(),
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
    linearListProjects: mockLinearListProjects,
    linearListProjectDocuments: mockLinearListProjectDocuments,
    linearListIssueComments: mockLinearListIssueComments,
    linearListProjectComments: mockLinearListProjectComments,
    linearListDocumentComments: mockLinearListDocumentComments,
  };
});

const TEAMS: LinearTeam[] = [{ id: "team-1", key: "ENG", name: "Engineering" }];

const VIEWER: LinearUser = { id: "user-me", name: "Ty" };
const ALICE: LinearUser = { id: "user-alice", name: "Alice" };

const PROJECT_A = { id: "project-a", name: "Search Revamp" };
const PROJECT_B = { id: "project-b", name: "Billing" };

const ISSUES: LinearIssue[] = [
  {
    id: "issue-1",
    identifier: "ENG-101",
    title: "Rework the ranking pipeline",
    description: "",
    state: { name: "In Progress", type: "started" },
    labels: ["backend"],
    branch_name: "eng-101",
    parent_id: null,
    sub_issue_ids: [],
    url: "https://linear.app/treq/issue/ENG-101",
    assignee: VIEWER,
    priority: 1,
    priority_label: "Urgent",
    project: PROJECT_A,
  },
  {
    id: "issue-2",
    identifier: "ENG-102",
    title: "Add typo tolerance to search",
    description: "",
    state: { name: "Todo", type: "unstarted" },
    labels: ["frontend"],
    branch_name: "eng-102",
    parent_id: null,
    sub_issue_ids: [],
    url: "https://linear.app/treq/issue/ENG-102",
    assignee: ALICE,
    priority: 2,
    priority_label: "High",
    project: PROJECT_A,
  },
  {
    id: "issue-3",
    identifier: "ENG-103",
    title: "Investigate invoice rounding error",
    description: "",
    state: { name: "Backlog", type: "backlog" },
    labels: ["bug"],
    branch_name: "eng-103",
    parent_id: null,
    sub_issue_ids: [],
    url: "https://linear.app/treq/issue/ENG-103",
    assignee: null,
    priority: 3,
    priority_label: "Medium",
    project: PROJECT_B,
  },
];

const PROJECTS: LinearProject[] = [
  {
    id: "project-a",
    name: "Search Revamp",
    description: "Improve search relevance and latency.",
    state: "started",
    target_date: "2026-12-01",
    progress: 0.4,
    url: "https://linear.app/treq/project/search-revamp",
    lead: VIEWER,
  },
  {
    id: "project-b",
    name: "Billing",
    description: "Overhaul the billing subsystem.",
    state: "planned",
    target_date: "2027-01-15",
    progress: 0.05,
    url: "https://linear.app/treq/project/billing",
    lead: ALICE,
  },
];

const DOCUMENTS: LinearDocument[] = [
  {
    id: "doc-1",
    title: "Search Revamp - Design Doc",
    content:
      "## Goals\n\nCut p95 search latency in half and improve relevance for typo-heavy queries.",
    url: "https://linear.app/treq/document/search-revamp-design",
    updated_at: "2026-08-01T00:00:00Z",
  },
];

const ISSUE_COMMENTS: LinearComment[] = [
  {
    id: "comment-1",
    body: "Started profiling the ranking pipeline, **p95 is 800ms** today.",
    user: VIEWER,
    created_at: "2026-08-02T10:00:00Z",
  },
];

const DOCUMENT_COMMENTS: LinearComment[] = [
  {
    id: "comment-2",
    body: "Looks good, one nit on the caching section.",
    user: ALICE,
    created_at: "2026-08-03T09:00:00Z",
    quoted_text: "Cut p95 search latency in half",
  },
];

const PROJECT_COMMENTS: LinearComment[] = [
  {
    id: "comment-3",
    body: "What's the target p99, not just p95?",
    user: ALICE,
    created_at: "2026-08-04T09:00:00Z",
    quoted_text: "Improve search relevance and latency.",
  },
];

it("filters issues by standard view and AND-combined filters, and browses projects/documents", async () => {
  const { repoPath } = createTestRepo(false);

  mockLinearListTeams.mockResolvedValue(TEAMS);
  mockLinearListIssues.mockResolvedValue(ISSUES);
  mockLinearGetViewer.mockResolvedValue(VIEWER);
  mockLinearListProjects.mockResolvedValue(PROJECTS);
  mockLinearListProjectDocuments.mockResolvedValue(DOCUMENTS);
  mockLinearListIssueComments.mockResolvedValue(ISSUE_COMMENTS);
  mockLinearListProjectComments.mockResolvedValue(PROJECT_COMMENTS);
  mockLinearListDocumentComments.mockResolvedValue(DOCUMENT_COMMENTS);

  const user = userEvent.setup();
  render(<LinearPanel repoPath={repoPath} />);

  await screen.findByText("Rework the ranking pipeline");

  await captureDocument(document, {
    name: "linear-views-filtering-01-issues-default",
    expectations: [
      'The Issues tab is active with standard-view subtabs "All Issues", "Active", "My Issues", "Backlog" visible above a row that combines the List/Kanban toggle with the team and filter dropdowns.',
      "All three issues (ENG-101, ENG-102, ENG-103) are visible in the list, each with a right-aligned outline Kick off button.",
    ],
  });

  await user.click(screen.getByText("Rework the ranking pipeline"));
  await screen.findByTestId("linear-issue-expanded");

  await captureDocument(document, {
    name: "linear-views-filtering-01b-issue-expanded",
    expectations: [
      'Clicking issue ENG-101 expanded an inline panel below it showing an "Activity" section.',
      'The activity panel shows a comment from "Ty" with bolded text "p95 is 800ms".',
    ],
  });

  await user.click(screen.getByText("Rework the ranking pipeline"));

  await user.click(screen.getByRole("tab", { name: "Active" }));
  await screen.findByText("Rework the ranking pipeline");

  await captureDocument(document, {
    name: "linear-views-filtering-02-active-view",
    expectations: [
      'With the "Active" standard view selected, only the started/unstarted issues ENG-101 and ENG-102 are shown.',
      "The backlog issue ENG-103 is not visible in the list.",
    ],
  });

  await user.click(screen.getByTestId("linear-issues-filter-trigger"));
  await screen.findByTestId("linear-filter-project");
  await user.keyboard(
    "{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowRight}",
  );
  const projectMenus = await waitForMenuCount(2);
  const projectSubmenu = projectMenus[projectMenus.length - 1]!;
  await user.click(within(projectSubmenu).getByText("Search Revamp"));
  await screen.findByText("Rework the ranking pipeline");

  await captureDocument(document, {
    name: "linear-views-filtering-03-project-filter-applied",
    expectations: [
      'A "Project: Search Revamp" chip is visible next to the Filter button.',
      "Only issues belonging to the Search Revamp project (ENG-101, ENG-102) are listed.",
    ],
  });

  await user.click(screen.getByRole("tab", { name: "Projects" }));
  await screen.findByTestId("linear-project-detail");

  await captureDocument(document, {
    name: "linear-views-filtering-04-projects-dual-column",
    expectations: [
      'A dual-column Projects layout is visible: preset-view subtabs ("All", "Mine", "Active", "Backlog") and a Filter button sit above a project list on the left (Search Revamp, Billing), with a detail panel on the right for the selected project.',
      'Below the project body, a phrase ("Improve search relevance and latency.") is highlighted with a yellow mark, and a right-hand comments column shows a quoted excerpt of that same phrase above a reply from "Alice".',
    ],
  });

  await user.click(screen.getByRole("tab", { name: "Active" }));
  await screen.findByTestId("linear-project-item-project-a");

  await captureDocument(document, {
    name: "linear-views-filtering-06-projects-active-view",
    expectations: [
      'With the "Active" preset view selected, only the started project Search Revamp is listed -- the planned Billing project is gone.',
    ],
  });

  await user.click(screen.getByRole("tab", { name: "All" }));
  await screen.findByTestId("linear-project-item-project-b");

  await user.click(screen.getByTestId("linear-projects-filter-trigger"));
  await screen.findByTestId("linear-filter-status");
  await user.keyboard("{ArrowDown}{ArrowRight}");
  const statusMenus = await waitForMenuCount(2);
  const statusSubmenu = statusMenus[statusMenus.length - 1]!;

  await captureDocument(document, {
    name: "linear-views-filtering-07-project-filter-nested-menu",
    expectations: [
      'An open submenu lists "Any", "planned", and "started" as selectable status options (opened from a "Status" entry in the main Filter menu).',
    ],
  });

  await user.click(within(statusSubmenu).getByText("planned"));
  await screen.findByTestId("linear-project-item-project-b");

  await captureDocument(document, {
    name: "linear-views-filtering-08-project-filter-chip",
    expectations: [
      'A "Status: planned" chip is visible next to the Filter button, and only the Billing project is listed in the left column.',
    ],
  });

  await user.click(
    screen.getByRole("button", { name: /clear status filter/i }),
  );
  await screen.findByTestId("linear-project-item-project-a");

  const projectDetail = screen.getByTestId("linear-project-detail");
  await user.click(
    within(projectDetail).getByText("Search Revamp - Design Doc"),
  );
  await screen.findAllByText(/Cut p95 search latency/);

  await captureDocument(document, {
    name: "linear-views-filtering-05-document-dialog",
    expectations: [
      'A dialog is open titled "Search Revamp - Design Doc" with the document content on the left (a "Goals" heading, not raw "## Goals" text) and a comments column on the right.',
      'The phrase "Cut p95 search latency in half" is highlighted with a yellow mark in the document, and the comments column shows that same phrase as a quoted excerpt above a reply from "Alice" about "the caching section".',
    ],
  });
}, 60000);
