import { expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import {
  commitWorkspaceFile,
  createTestRepo,
  findSidebarBranchElement,
  openRepo,
  resolveWorkspacePath,
  writeWorkspaceFile,
} from "../../../test/utils";
import {
  checkAndRebaseWorkspaces,
  createCommit,
  createWorkspace,
  ensureWorkspaceIndexed,
  getWorkspaces,
} from "../../../src/lib/api";
import { render, screen, waitFor } from "../../../test/test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import { captureDocument } from "../capture";

// Verifies the right-aligned agent-session spinner: grey with no changes,
// yellow with uncommitted changes, blue with committed-but-unmerged changes,
// and red (replacing the static conflict triangle) when conflicted -- all
// only while the workspace has at least one open agent terminal.
it("shows a color-coded spinner per workspace git state while an agent session is open", async () => {
  const { repoPath, defaultBranch } = createTestRepo(false);
  openRepo(repoPath);

  const cleanId = await createWorkspace(repoPath, "feat/agent-clean");
  const dirtyId = await createWorkspace(repoPath, "feat/agent-dirty");
  const aheadId = await createWorkspace(repoPath, "feat/agent-ahead");
  const conflictId = await createWorkspace(repoPath, "feat/agent-conflict");
  await createWorkspace(repoPath, "feat/no-agent-conflict");

  const workspaces = await getWorkspaces(repoPath);
  const dirty = workspaces.find((w) => w.id === dirtyId)!;
  const ahead = workspaces.find((w) => w.id === aheadId)!;
  const conflict = workspaces.find((w) => w.id === conflictId)!;
  const noAgentConflict = workspaces.find(
    (w) => w.branch_name === "feat/no-agent-conflict",
  )!;

  // Uncommitted change.
  writeWorkspaceFile(
    resolveWorkspacePath(repoPath, dirty.workspace_path),
    "dirty.txt",
    "uncommitted\n",
  );

  // Committed change not yet merged into the target branch.
  await commitWorkspaceFile(
    repoPath,
    { id: ahead.id, path: ahead.workspace_path },
    "ahead.txt",
    "committed\n",
    "Ahead of target",
  );

  // Real conflict, on both the agent-session and non-agent-session rows.
  for (const target of [
    { id: conflict.id, path: conflict.workspace_path },
    { id: noAgentConflict.id, path: noAgentConflict.workspace_path },
  ]) {
    const workspacePath = resolveWorkspacePath(repoPath, target.path);
    writeWorkspaceFile(workspacePath, "README.md", "workspace side\n");
    await createCommit(repoPath, target.id, "workspace conflicting change");
  }
  writeWorkspaceFile(repoPath, "README.md", "main side\n");
  await createCommit(repoPath, null, "main conflicting change");
  for (const target of [conflict, noAgentConflict]) {
    await checkAndRebaseWorkspaces(repoPath, target.id, defaultBranch, true);
    await ensureWorkspaceIndexed(
      repoPath,
      target.id,
      resolveWorkspacePath(repoPath, target.workspace_path),
    );
  }

  const user = userEvent.setup();
  render(<Dashboard />);

  async function openAgentSession(branchName: string) {
    await user.click(await findSidebarBranchElement(branchName));
    await screen.findByTestId("workspace-terminal-pane");
    await user.keyboard("{Meta>}]{/Meta}");
    await waitFor(() => {
      expect(
        document.querySelector('[data-terminal-id^="claude-"]'),
      ).not.toBeNull();
    });
  }

  await openAgentSession("feat/agent-clean");
  await openAgentSession("feat/agent-dirty");
  await openAgentSession("feat/agent-ahead");
  await openAgentSession("feat/agent-conflict");

  await screen.findByTestId(`workspace-agent-session-spinner-${cleanId}`);
  await screen.findByTestId(`workspace-agent-session-spinner-${dirtyId}`);
  await screen.findByTestId(`workspace-agent-session-spinner-${aheadId}`);
  await screen.findByTestId(`workspace-agent-session-spinner-${conflictId}`);
  await screen.findByTestId(
    `workspace-conflict-indicator-${noAgentConflict.id}`,
  );
  expect(
    screen.queryByTestId(`workspace-agent-session-spinner-${noAgentConflict.id}`),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByTestId(`workspace-conflict-indicator-${conflictId}`),
  ).not.toBeInTheDocument();

  await captureDocument(document, {
    name: "workspace-agent-session-spinner-01-states",
    expectations: [
      "feat/agent-clean shows a grey spinning loader icon flush to the right edge of its row.",
      "feat/agent-dirty shows a yellow spinning loader icon and feat/agent-ahead shows a blue spinning loader icon, each in that same right-edge slot.",
      "feat/agent-conflict shows a red spinning loader icon (not a static triangle) while feat/no-agent-conflict shows the static red conflict triangle instead of a spinner.",
    ],
  });
}, 120000);
