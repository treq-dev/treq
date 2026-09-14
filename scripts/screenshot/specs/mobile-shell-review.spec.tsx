import * as React from "react";
import { it } from "vitest";
import userEvent from "@testing-library/user-event";
import {
  createTestRepo,
  newCommitWithParents,
  openRepo,
  resolveChangeId,
  resolveWorkspacePath,
  writeWorkspaceFile,
} from "../../../test/utils";
import {
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
  const { repoPath } = createTestRepo(false);
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
  const workspaceChangeId = resolveChangeId(workspacePath, "@-");

  // A conflicting commit on the other side.
  writeWorkspaceFile(repoPath, "README.md", "main side\n");
  await createCommit(repoPath, null, "main conflicting change");
  const mainChangeId = resolveChangeId(repoPath, "@-");

  // Merge them: produces a real conflict in the working copy.
  newCommitWithParents(workspacePath, [workspaceChangeId, mainChangeId]);
  await ensureWorkspaceIndexed(repoPath, workspaceId, workspacePath);

  // An extra uncommitted change for the Changes tab.
  writeWorkspaceFile(workspacePath, "notes.txt", "a fresh note\n");

  await setSetting("lastRepoPath", repoPath);

  const user = userEvent.setup();
  render(<MobileShell />);

  const workspaceButton = await screen.findByText(branchName);
  await captureDocument(document, {
    name: "mobile-shell-review-01-workspace-list",
    expectations: [
      "A single-column mobile layout with a 'Treq' header and a workspace list.",
      `A workspace entry labeled "${branchName}" is visible as a tappable row.`,
    ],
  });

  await user.click(workspaceButton);
  await screen.findByText("notes.txt");
  await captureDocument(document, {
    name: "mobile-shell-review-02-changes-tab",
    expectations: [
      "Changes/History/Conflicts tabs are visible with Changes selected.",
      "A file row for notes.txt is listed under the changes.",
    ],
  });

  await user.click(screen.getByText("notes.txt"));
  await screen.findByText(/a fresh note/);
  await captureDocument(document, {
    name: "mobile-shell-review-03-changes-expanded",
    expectations: [
      "The notes.txt file row is expanded to show its diff hunk inline.",
      "Added lines are shown with a green/positive background and a leading +.",
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
