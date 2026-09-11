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

// Verifies the workspace sidebar's right-aligned git status indicator:
// - no active agent session: no dot when clean, a static yellow dot with
//   uncommitted changes, and the static red conflict triangle when conflicted.
// - with an active agent session: the triangle/dot slot instead shows a
//   color-coded dot that spins while the session streams -- blue when there
//   are no uncommitted changes (grey was dropped), yellow with uncommitted
//   changes, and red (never the triangle) when conflicted.
it("shows the right git-state indicator for sessioned and session-less workspaces", async () => {
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

  // No-session rows: no dot when clean, yellow dot when dirty, triangle when conflicted.
  expect(
    screen.queryByTestId(`workspace-status-indicator-${noSessionCleanId}`),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByTestId(`workspace-conflict-indicator-${noSessionCleanId}`),
  ).not.toBeInTheDocument();
  await screen.findByTestId(`workspace-status-indicator-${noSessionDirtyId}`);
  await screen.findByTestId(
    `workspace-conflict-indicator-${noSessionConflictId}`,
  );

  // Session rows: dot in place of the triangle, never both at once.
  await screen.findByTestId(`workspace-status-indicator-${sessionCleanId}`);
  await screen.findByTestId(`workspace-status-indicator-${sessionDirtyId}`);
  await screen.findByTestId(`workspace-status-indicator-${sessionConflictId}`);
  expect(
    screen.queryByTestId(`workspace-conflict-indicator-${sessionConflictId}`),
  ).not.toBeInTheDocument();

  await captureDocument(document, {
    name: "workspace-agent-session-spinner-01-states",
    expectations: [
      "feat/no-session-clean has no dot or triangle at its right edge, feat/no-session-dirty shows a small yellow dot, and feat/no-session-conflict shows a red conflict triangle.",
      "feat/session-clean and feat/session-dirty each show a small colored indicator (blue for clean, yellow for dirty) at the right edge in place of any triangle.",
      "feat/session-conflict shows a red indicator at its right edge, not the static conflict triangle.",
    ],
  });
}, 120000);
