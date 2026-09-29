/**
 * Chaos pass over the agent sessions UX: pile several sessions up through
 * different entry points, close, reset, change model, double-submit, and
 * switch workspaces, capturing what a user sees at each step.
 */
import userEvent from "@testing-library/user-event";
import { expect, it, onTestFinished } from "vitest";
import { Dashboard } from "../../../src/components/Dashboard";
import { createWorkspace, getSessions } from "../../../src/lib/api";
import { installFakeAgents } from "../../../test/fake-agent";
import { render, screen, waitFor, within } from "../../../test/test-utils";
import { createTestRepo, openRepo } from "../../../test/utils";
import { captureDocument } from "../capture";

const agentColumns = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>('[data-terminal-id^="claude-"]'),
  );

const pane = () => screen.getByTestId("workspace-terminal-pane");

async function submitTask(
  user: ReturnType<typeof userEvent.setup>,
  text: string,
) {
  const input = await screen.findByTestId("agent-task-input");
  await user.type(
    within(input).getByPlaceholderText("Describe a task..."),
    text,
  );
  await user.click(within(input).getByRole("button", { name: /^edit$/i }));
}

it("piles up sessions from every entry point", async () => {
  onTestFinished(installFakeAgents());
  const { repoPath } = createTestRepo(false);
  openRepo(repoPath);
  const user = userEvent.setup();
  render(<Dashboard />);
  await screen.findByTestId("show-workspace-header");

  await submitTask(user, "First task from the overview");
  await within(pane()).findByText(
    "prompt: First task from the overview",
    {},
    { timeout: 15000 },
  );

  const homeRow = document.querySelector(
    '[aria-label="Start agent"]',
  ) as HTMLElement;
  await user.click(homeRow);
  await waitFor(() => expect(agentColumns()).toHaveLength(2), {
    timeout: 15000,
  });

  await user.keyboard("{Meta>}]{/Meta}");
  await waitFor(() => expect(agentColumns()).toHaveLength(3), {
    timeout: 15000,
  });
  await waitFor(
    () => expect(within(pane()).getAllByText("ready")).toHaveLength(3),
    { timeout: 15000 },
  );

  await captureDocument(document, {
    name: "sessions-chaos-01-three-sessions",
    expectations: [
      "The bottom pane holds three agent columns, one per entry point (task input, sidebar button, Cmd+]).",
      "Each column header names its session; check whether the names tell the three apart.",
      "Check whether all three columns fit or the pane scrolls sideways.",
    ],
  });

  await user.click(
    within(pane()).getByRole("button", { name: "Maximize terminal" }),
  );
  await captureDocument(document, {
    name: "sessions-chaos-02-maximized",
    expectations: [
      "The terminal pane fills most of the window with the three agent columns.",
    ],
  });

  const names = agentColumns().map((c) => c.textContent?.slice(0, 80));
  console.info("[chaos] column headers", JSON.stringify(names));
  const sessions = await getSessions(repoPath);
  console.info(
    "[chaos] db sessions",
    JSON.stringify(sessions.map((s) => ({ id: s.id, name: s.name }))),
  );
}, 120000);

it("closes with X, then Cmd+W", async () => {
  onTestFinished(installFakeAgents());
  const { repoPath } = createTestRepo(false);
  openRepo(repoPath);
  const user = userEvent.setup();
  render(<Dashboard />);
  await screen.findByTestId("show-workspace-header");

  for (let i = 1; i <= 3; i++) {
    await user.keyboard("{Meta>}]{/Meta}");
    await waitFor(() => expect(agentColumns()).toHaveLength(i), {
      timeout: 15000,
    });
  }
  await waitFor(
    () => expect(within(pane()).getAllByText("ready")).toHaveLength(3),
    { timeout: 15000 },
  );

  // Focus the middle column, close it with its X.
  const middle = agentColumns()[1];
  await user.click(middle);
  await user.click(
    within(middle).getByRole("button", { name: "Close session" }),
  );
  await waitFor(() => expect(agentColumns()).toHaveLength(2));
  await captureDocument(document, {
    name: "sessions-chaos-03-after-x-close",
    expectations: [
      "Two agent columns remain; no column header is highlighted as active, or the highlight sits on a surviving column.",
    ],
  });

  // Cmd+W right after: a user expects it to close the next terminal.
  await user.keyboard("{Meta>}w{/Meta}");
  await new Promise((r) => setTimeout(r, 500));
  console.info("[chaos] columns after Cmd+W", agentColumns().length);
  await captureDocument(document, {
    name: "sessions-chaos-04-after-cmd-w",
    expectations: [
      "Records whether Cmd+W right after an X-close closed another terminal (one column) or did nothing (two).",
    ],
  });
}, 120000);

it("resets a prompted session and changes its model", async () => {
  onTestFinished(installFakeAgents());
  const { repoPath } = createTestRepo(false);
  openRepo(repoPath);
  const user = userEvent.setup();
  render(<Dashboard />);
  await screen.findByTestId("show-workspace-header");

  await submitTask(user, "Refactor the parser");
  await within(pane()).findByText(
    "prompt: Refactor the parser",
    {},
    { timeout: 15000 },
  );
  await within(pane()).findByText("ready", {}, { timeout: 15000 });
  const column = agentColumns()[0];

  await user.click(
    within(column).getByRole("button", { name: "Reset terminal" }),
  );
  await new Promise((r) => setTimeout(r, 2500));
  const afterReset = within(pane()).queryAllByText(
    "prompt: Refactor the parser",
  );
  console.info("[chaos] prompt lines after reset", afterReset.length);
  await captureDocument(document, {
    name: "sessions-chaos-05-after-reset",
    expectations: [
      "Records what Reset does: whether the fresh agent shows 'prompt: Refactor the parser' again (the task re-sent) or 'prompt: <none>'.",
      "Records the toast text shown for the reset.",
    ],
  });

  await user.click(
    within(agentColumns()[0]).getByRole("button", { name: /^Model:/ }),
  );
  await user.click(await screen.findByRole("menuitem", { name: /^Opus$/ }));
  await within(pane()).findByText("model: opus", {}, { timeout: 15000 });
  await captureDocument(document, {
    name: "sessions-chaos-06-after-model-change",
    expectations: [
      "The agent restarted with 'model: opus'; records whether the prompt was sent a third time.",
      "The header's model label now reads Opus.",
    ],
  });
}, 120000);

it("double-clicks Edit", async () => {
  onTestFinished(installFakeAgents());
  const { repoPath } = createTestRepo(false);
  openRepo(repoPath);
  const user = userEvent.setup();
  render(<Dashboard />);
  await screen.findByTestId("show-workspace-header");
  const input = await screen.findByTestId("agent-task-input");
  await user.type(
    within(input).getByPlaceholderText("Describe a task..."),
    "Only once",
  );
  await user.dblClick(within(input).getByRole("button", { name: /^edit$/i }));
  await new Promise((r) => setTimeout(r, 2000));
  const sessions = await getSessions(repoPath);
  console.info(
    "[chaos] sessions after double click",
    sessions.length,
    agentColumns().length,
  );
  expect(sessions.length).toBeGreaterThan(0);
  await captureDocument(document, {
    name: "sessions-chaos-07-double-submit",
    expectations: [
      "Records how many agent columns a double-click on Edit produced.",
    ],
  });
}, 120000);

it("switches between workspaces with sessions", async () => {
  onTestFinished(installFakeAgents());
  const { repoPath } = createTestRepo(false);
  openRepo(repoPath);
  await createWorkspace(repoPath, "feat/alpha");
  await createWorkspace(repoPath, "feat/beta");
  const user = userEvent.setup();
  render(<Dashboard />);
  await screen.findByTestId("show-workspace-header");

  for (const branch of ["feat/alpha", "feat/beta"]) {
    await user.click(
      await screen
        .findByText(branch, {
          selector: "aside *, nav *, [data-testid*=sidebar] *",
        })
        .catch(() => screen.findAllByText(branch).then((els) => els[0])),
    );
    await waitFor(() =>
      expect(screen.getByTestId("show-workspace-header")).toHaveTextContent(
        branch,
      ),
    );
    await submitTask(user, `Work on ${branch}`);
    await within(pane()).findByText(
      `prompt: Work on ${branch}`,
      {},
      { timeout: 15000 },
    );
  }
  await captureDocument(document, {
    name: "sessions-chaos-08-two-workspaces",
    expectations: [
      "The pane shows both workspaces' sessions side by side, each with its branch chip.",
      "Records whether the sidebar marks both workspaces as having a running agent.",
    ],
  });

  await user.click((await screen.findAllByText("feat/alpha"))[0]);
  await waitFor(() =>
    expect(screen.getByTestId("show-workspace-header")).toHaveTextContent(
      "feat/alpha",
    ),
  );
  await new Promise((r) => setTimeout(r, 500));
  await captureDocument(document, {
    name: "sessions-chaos-09-back-to-alpha",
    expectations: [
      "Records which column is active and visible after switching back to feat/alpha.",
    ],
  });
}, 120000);
