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

// Verifies the workspace sidebar's right-aligned git status pip: nothing
// when clean, a yellow pip with uncommitted changes, and a red pip when
// conflicted -- the same for every workspace whether or not it has an open
// agent session (an open session only makes the pip spin while it streams).
it("shows the right git-state pip for sessioned and session-less workspaces", async () => {
  const { repoPath, defaultBranch } = createTestRepo(false);
  openRepo(repoPath);

  const noSessionCleanId = await createWorkspace(repoPath, "feat/no-session-clean");
  const noSessionDirtyId = await createWorkspace(repoPath, "feat/no-session-dirty");
  const noSessionConflictId = await createWorkspace(
    repoPath,
    "feat/no-session-conflict",
  );
  const sessionCleanId = await createWorkspace(repoPath, "feat/session-clean");
  const sessionDirtyId = await createWorkspace(repoPath, "feat/session-dirty");
  const sessionConflictId = await createWorkspace(repoPath, "feat/session-conflict");

  const workspaces = await getWorkspaces(repoPath);
  const byId = (id: number) => workspaces.find((w) => w.id === id)!;
  const noSessionDirty = byId(noSessionDirtyId);
  const sessionDirty = byId(sessionDirtyId);
  const conflictRows = [byId(noSessionConflictId), byId(sessionConflictId)];

  // Uncommitted changes on the two "dirty" rows.
  for (const ws of [noSessionDirty, sessionDirty]) {
    const workspacePath = resolveWorkspacePath(repoPath, ws.workspace_path);
    writeWorkspaceFile(workspacePath, "dirty.txt", "uncommitted\n");
  }

  // Real conflicts on the two "conflict" rows.
  for (const ws of conflictRows) {
    const workspacePath = resolveWorkspacePath(repoPath, ws.workspace_path);
    writeWorkspaceFile(workspacePath, "README.md", "workspace side\n");
    await createCommit(repoPath, ws.id, "workspace conflicting change");
  }
  writeWorkspaceFile(repoPath, "README.md", "main side\n");
  await createCommit(repoPath, null, "main conflicting change");
  for (const ws of conflictRows) {
    await checkAndRebaseWorkspaces(repoPath, ws.id, defaultBranch, true);
    await ensureWorkspaceIndexed(
      repoPath,
      ws.id,
      resolveWorkspacePath(repoPath, ws.workspace_path),
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

  await openAgentSession("feat/session-clean");
  await openAgentSession("feat/session-dirty");
  await openAgentSession("feat/session-conflict");

  // Clean rows never show a pip, session or not.
  expect(
    screen.queryByTestId(`workspace-status-indicator-${noSessionCleanId}`),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByTestId(`workspace-conflict-indicator-${noSessionCleanId}`),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByTestId(`workspace-status-indicator-${sessionCleanId}`),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByTestId(`workspace-conflict-indicator-${sessionCleanId}`),
  ).not.toBeInTheDocument();

  // Dirty rows show the yellow pip, session or not.
  await screen.findByTestId(`workspace-status-indicator-${noSessionDirtyId}`);
  await screen.findByTestId(`workspace-status-indicator-${sessionDirtyId}`);

  // Conflicted rows show the red pip, session or not.
  await screen.findByTestId(
    `workspace-conflict-indicator-${noSessionConflictId}`,
  );
  await screen.findByTestId(`workspace-conflict-indicator-${sessionConflictId}`);

  await captureDocument(document, {
    name: "workspace-agent-session-spinner-01-states",
    expectations: [
      "feat/no-session-clean and feat/session-clean have no pip at their right edge at all.",
      "feat/no-session-dirty and feat/session-dirty each show a small yellow pip at the right edge.",
      "feat/no-session-conflict and feat/session-conflict each show a small red pip at the right edge.",
    ],
  });
}, 120000);
