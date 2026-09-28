import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "../../src/components/Dashboard";
import { createWorkspace, getSessions, getWorkspaces } from "../../src/lib/api";
import type { LinearIssue } from "../../src/lib/api-linear";
import type { TrackerItem } from "../../src/lib/api-tracker";
import { render, screen, waitFor, within } from "../test-utils";
import {
  createTestRepo,
  findSidebarBranchElement,
  openRepo,
  setOriginUrl,
} from "../utils";

const external = vi.hoisted(() => ({
  ghListIssues: vi.fn(),
  ghViewIssue: vi.fn(),
  linearListIssues: vi.fn(),
  linearListTeams: vi.fn(),
  linearGetViewer: vi.fn(),
  linearOpenOrCreateWorkspaceFromIssue: vi.fn(),
  trackerListContainers: vi.fn(),
  trackerListItems: vi.fn(),
  trackerGetViewer: vi.fn(),
  trackerOpenOrCreateWorkspaceFromItem: vi.fn(),
}));

vi.mock("../../src/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/api")>()),
  ghListIssues: external.ghListIssues,
  ghViewIssue: external.ghViewIssue,
  ghListPrs: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
  getCachedPrInfo: vi.fn().mockResolvedValue(null),
  startPrStatusPolling: vi.fn(async () => undefined),
  refreshPrStatuses: vi.fn(async () => undefined),
}));
vi.mock("../../src/lib/api-linear", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/api-linear")>()),
  linearListIssues: external.linearListIssues,
  linearListTeams: external.linearListTeams,
  linearGetViewer: external.linearGetViewer,
  linearOpenOrCreateWorkspaceFromIssue:
    external.linearOpenOrCreateWorkspaceFromIssue,
}));
vi.mock("../../src/lib/api-tracker", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/api-tracker")>()),
  trackerListContainers: external.trackerListContainers,
  trackerListItems: external.trackerListItems,
  trackerGetViewer: external.trackerGetViewer,
  trackerOpenOrCreateWorkspaceFromItem:
    external.trackerOpenOrCreateWorkspaceFromItem,
}));

const GITHUB_ISSUE = {
  number: 42,
  title: "Fix the login redirect",
  state: "OPEN",
  url: "https://github.com/acme/treq/issues/42",
  body: "Users land on /dashboard.",
  author: { login: "alice", avatar_url: null },
  labels: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  comments: null,
};

const LINEAR_ISSUE: LinearIssue = {
  id: "issue-1",
  identifier: "ENG-101",
  title: "Rework the ranking pipeline",
  description: "",
  state: { name: "Todo", type: "unstarted" },
  labels: [],
  branch_name: "eng-101-rework-the-ranking-pipeline",
  parent_id: null,
  sub_issue_ids: [],
  url: "https://linear.app/acme/issue/ENG-101",
};

const trackerItem = (key: string, branch: string): TrackerItem => ({
  id: key,
  key,
  title: `Tracker item ${key}`,
  description: "",
  url: `https://tracker.test/${key}`,
  status: { name: "To Do", category: "todo" },
  labels: [],
  assignees: [],
  container: { id: "c1", name: "Board", key: "B" },
  branch_name: branch,
  parent_id: null,
  sub_item_ids: [],
});

type Case = {
  source: string;
  label: string;
  key: string;
  branch: string;
  setup: (repoPath: string) => void;
  open: (user: ReturnType<typeof userEvent.setup>) => Promise<void>;
};

const CASES: Case[] = [
  {
    source: "GitHub",
    label: "GitHub",
    key: "#42",
    branch: "github-42-fix-the-login-redirect",
    setup: (repoPath) => {
      setOriginUrl(repoPath, "https://github.com/acme/treq.git");
      external.ghListIssues.mockResolvedValue({
        items: [GITHUB_ISSUE],
        hasMore: false,
      });
      external.ghViewIssue.mockResolvedValue(GITHUB_ISSUE);
    },
    open: async (user) => {
      await user.click(await screen.findByTestId("github-sidebar-item"));
      await user.click(await screen.findByText(GITHUB_ISSUE.title));
      await user.click(await screen.findByRole("button", { name: /^agent/i }));
    },
  },
  {
    source: "Linear",
    label: "Linear",
    key: "ENG-101",
    branch: LINEAR_ISSUE.branch_name,
    setup: () => {
      external.linearListTeams.mockResolvedValue([]);
      external.linearListIssues.mockResolvedValue([LINEAR_ISSUE]);
      external.linearGetViewer.mockResolvedValue({ id: "me", name: "Me" });
      external.linearOpenOrCreateWorkspaceFromIssue.mockImplementation(
        async (path: string) => [
          {
            issue_id: LINEAR_ISSUE.id,
            workspace_id: await createWorkspace(path, LINEAR_ISSUE.branch_name),
            created: true,
          },
        ],
      );
    },
    open: async (user) => {
      await user.click(await screen.findByTestId("linear-sidebar-item"));
      await user.click(await screen.findByRole("button", { name: "Kick off" }));
    },
  },
  ...(["trello", "jira"] as const).map((provider) => {
    const key = provider === "trello" ? "#12" : "ENG-42";
    const item = trackerItem(key, `${provider}-item-branch`);
    return {
      source: provider === "trello" ? "Trello" : "Jira",
      label: provider === "trello" ? "Trello" : "Jira",
      key,
      branch: item.branch_name,
      setup: () => {
        external.trackerListContainers.mockResolvedValue([item.container]);
        external.trackerListItems.mockResolvedValue([item]);
        external.trackerGetViewer.mockResolvedValue({ id: "me", name: "Me" });
        external.trackerOpenOrCreateWorkspaceFromItem.mockImplementation(
          async (path: string) => [
            {
              item_id: item.id,
              workspace_id: await createWorkspace(path, item.branch_name),
              created: true,
            },
          ],
        );
      },
      open: async (user: ReturnType<typeof userEvent.setup>) => {
        await user.click(await screen.findByTestId(`${provider}-sidebar-item`));
        await user.click(
          await screen.findByRole("button", { name: "Kick off" }),
        );
      },
    };
  }),
];

describe.each(CASES)("$source issue kickoff", (c) => {
  let user: ReturnType<typeof userEvent.setup>;
  let repoPath: string;

  beforeEach(() => {
    ({ repoPath } = createTestRepo(false));
    openRepo(repoPath);
    user = userEvent.setup();
    c.setup(repoPath);
  });

  it("uses the shared dialog and starts the session in the issue's workspace", async () => {
    render(<Dashboard />);
    await c.open(user);

    const dialog = (
      await screen.findByRole("heading", { name: "Start a new agent session" })
    ).closest('[data-testid="modal"]') as HTMLElement;
    expect(await within(dialog).findByTestId("issue-chip")).toHaveTextContent(
      `${c.label} ${c.key}`,
    );
    expect(
      within(dialog).getByText(`Opens a workspace for ${c.key}`),
    ).toBeInTheDocument();
    expect(
      dialog.querySelector('button[role="combobox"]'),
    ).not.toBeInTheDocument();

    await user.type(
      within(dialog).getByPlaceholderText("Describe a task..."),
      "Implement it",
    );
    await user.click(within(dialog).getByRole("button", { name: /^edit$/i }));

    expect(await findSidebarBranchElement(c.branch)).toBeTruthy();
    await waitFor(async () => {
      const workspace = (await getWorkspaces(repoPath)).find(
        (ws) => ws.branch_name === c.branch,
      );
      const sessions = await getSessions(repoPath);
      expect(workspace).toBeDefined();
      expect(sessions.map((s) => s.workspace_id)).toContain(workspace?.id);
    });
  }, 60000);
});
