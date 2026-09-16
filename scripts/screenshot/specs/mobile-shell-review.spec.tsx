import * as React from "react";
import { it } from "vitest";
import userEvent from "@testing-library/user-event";
import {
  createTestRepo,
  openRepo,
  resolveWorkspacePath,
  seedAgentReviewComment,
  writeWorkspaceFile,
} from "../../../test/utils";
import {
  checkAndRebaseWorkspaces,
  createCommit,
  createWorkspace,
  ensureWorkspaceIndexed,
  getWorkspaces,
  setSetting,
} from "../../../src/lib/api";
import { render, screen } from "../../../test/test-utils";
import { MobileShell } from "../../../src/components/MobileShell";
import { captureDocument } from "../capture";

it("captures the mobile shell's changes, history, and conflicts tabs", async () => {
  const branchName = "feat/mobile-review";
  const { repoPath, defaultBranch } = createTestRepo(false);
  openRepo(repoPath);

  const workspaceId = await createWorkspace(repoPath, branchName);
  const workspace = (await getWorkspaces(repoPath)).find(
    (w) => w.id === workspaceId,
  );
  if (!workspace) throw new Error("Workspace not found");
  const workspacePath = resolveWorkspacePath(
    repoPath,
    workspace.workspace_path,
  );

  // A committed history entry.
  writeWorkspaceFile(workspacePath, "README.md", "workspace side\n");
  await createCommit(repoPath, workspaceId, "workspace conflicting change");

  // A conflicting commit on the other side, then rebase onto it: produces a
  // real conflict with resolvable diff regions (matches the fixture used by
  // test/integration/review/conflict.test.tsx's InlineConflictCard coverage).
  writeWorkspaceFile(repoPath, "README.md", "main side\n");
  await createCommit(repoPath, null, "main conflicting change");
  await checkAndRebaseWorkspaces(repoPath, workspaceId, defaultBranch, true);
  await ensureWorkspaceIndexed(repoPath, workspaceId, workspacePath);

  // An extra uncommitted change for the Changes tab.
  writeWorkspaceFile(workspacePath, "notes.txt", "a fresh note\n");

  // Seeded before MobileShell mounts: the review-comments hook disables SWR
  // polling in test mode, so only the diff view's initial fetch on mount will
  // ever pick up a row inserted this way.
  seedAgentReviewComment(repoPath, {
    workspaceId,
    filePath: "notes.txt",
    startLine: 1,
    side: "new",
    commentText: "Consider adding a timestamp to this note.",
  });

  await setSetting("lastRepoPath", repoPath);

  const user = userEvent.setup();
  render(<MobileShell />);

  const workspaceButton = await screen.findByText(workspace.workspace_name);
  await captureDocument(document, {
    name: "mobile-shell-review-01-workspace-list",
    expectations: [
      "A single-column mobile layout with a 'Treq' header and a workspace list.",
      `A workspace entry labeled "${workspace.workspace_name}" is visible as a tappable row.`,
    ],
  });

  await user.click(workspaceButton);
  await screen.findByText("notes.txt");
  await captureDocument(document, {
    name: "mobile-shell-review-02-changes-tab",
    expectations: [
      "Changes/History/Conflicts tabs are visible with Changes selected.",
      "A file row for notes.txt is listed under the changes.",
      'A "1 local review comment" indicator with a bot icon is visible above the file list.',
    ],
  });

  await user.click(screen.getByText("notes.txt"));
  await screen.findByText(/a fresh note/);
  await screen.findByTestId("agent-review-comment-card");
  await captureDocument(document, {
    name: "mobile-shell-review-03-changes-expanded",
    expectations: [
      "The notes.txt file row is expanded to show its diff hunk inline.",
      "Added lines are shown with a green/positive background and a leading +.",
      'A "Local" badged review comment card is shown under the added line, with Resolve and Delete actions.',
    ],
  });

  await user.click(screen.getByRole("tab", { name: "History" }));
  await screen.findByText("Commits");
  await captureDocument(document, {
    name: "mobile-shell-review-04-history-tab",
    expectations: [
      "A vertical commit timeline is shown under a 'Commits' heading.",
      "At least one commit entry with a headline is visible in the list.",
    ],
  });

  await user.click(screen.getByRole("tab", { name: "Conflicts" }));
  await screen.findByText("README.md");
  await captureDocument(document, {
    name: "mobile-shell-review-05-conflicts-tab",
    expectations: [
      "A conflicts list is shown with a README.md entry marked as conflicted.",
    ],
  });

  await user.click(screen.getByText("README.md"));
  await screen.findByText(/Conflict 1 of/);
  await captureDocument(document, {
    name: "mobile-shell-review-06-conflict-detail",
    expectations: [
      "A 'Back to conflicts' link and the conflicted file path are shown above the conflict markers.",
      "Conflict marker lines and both sides' content are rendered in a monospace block.",
    ],
  });
}, 60000);
