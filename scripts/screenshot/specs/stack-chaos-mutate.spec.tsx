import * as React from "react";
import { expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import {
  commitWorkspaceFile,
  createTestRepo,
  findSidebarBranchElement,
  openRepo,
} from "../../../test/utils";
import { render, screen, waitFor, within } from "../../../test/test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import { getWorkspaces } from "../../../src/lib/api";
import { captureDocument } from "../capture";

import { appendFileSync } from "node:fs";
const chaosLog = (...a: unknown[]) =>
  appendFileSync("/tmp/claude-0/chaos.log", `${a.join(" ")}\n`);

type User = ReturnType<typeof userEvent.setup>;

async function stackFromHome(user: User, branchName: string) {
  await user.click(await screen.findByTestId("home-repo-row"));
  await screen.findByTestId("show-workspace-header");
  await user.click(await screen.findByRole("button", { name: "Stack" }));
  const dialog = await screen.findByTestId("modal");
  await user.type(within(dialog).getByLabelText("Branch Name"), branchName);
  await user.click(
    within(dialog).getByRole("button", { name: "Create Workspace" }),
  );
  await waitFor(() =>
    expect(screen.queryByTestId("modal")).not.toBeInTheDocument(),
  );
}

async function stackOn(
  user: User,
  parentBranch: string,
  branchName: string,
  position: "after" | "before" = "after",
) {
  const label = await findSidebarBranchElement(parentBranch);
  const row = label.closest("div") as HTMLElement;
  await user.hover(row);
  await user.click(
    await within(row).findByRole("button", { name: "Stack a workspace" }),
  );
  const dialog = await screen.findByTestId("modal");
  if (position === "before") {
    await user.click(within(dialog).getByRole("button", { name: /^before$/i }));
  }
  await user.type(within(dialog).getByLabelText("Branch Name"), branchName);
  await user.click(
    within(dialog).getByRole("button", { name: "Create Workspace" }),
  );
  await waitFor(() =>
    expect(screen.queryByTestId("modal")).not.toBeInTheDocument(),
  );
}

async function commitOn(repoPath: string, branch: string, message: string) {
  const ws = (await getWorkspaces(repoPath)).find(
    (w) => w.branch_name === branch,
  );
  if (!ws) throw new Error(`missing ${branch}`);
  await commitWorkspaceFile(
    repoPath,
    { id: ws.id, path: ws.workspace_path },
    `${branch.replace(/\//g, "-")}.txt`,
    message,
    message,
  );
}

async function targets(repoPath: string) {
  return Object.fromEntries(
    (await getWorkspaces(repoPath)).map((w) => [w.branch_name, w.target_branch]),
  );
}

const settle = () => new Promise((r) => setTimeout(r, 700));

// Chaos: archive the middle of A -> B -> C. What does C end up stacked on?
it("stack chaos: archiving the middle of a stack", async () => {
  const { repoPath } = createTestRepo(false);
  openRepo(repoPath);
  const user = userEvent.setup();
  render(<Dashboard />);

  await stackFromHome(user, "mid/a");
  await commitOn(repoPath, "mid/a", "A commit");
  await stackOn(user, "mid/a", "mid/b");
  await commitOn(repoPath, "mid/b", "B commit");
  await stackOn(user, "mid/b", "mid/c");
  await commitOn(repoPath, "mid/c", "C commit");

  const b = await findSidebarBranchElement("mid/b");
  await user.pointer({ keys: "[MouseRight]", target: b });
  await user.click(await screen.findByText("Archive Workspace"));
  const sidebar = await screen.findByTestId("workspace-sidebar");
  await waitFor(() =>
    expect(within(sidebar).queryByText("mid/b")).not.toBeInTheDocument(),
  );
  const t = await targets(repoPath);
  chaosLog("[chaos] targets after archiving middle", JSON.stringify(t));

  await user.click(await findSidebarBranchElement("mid/c"));
  await user.click(await screen.findByRole("tab", { name: /^Commits/ }));
  await screen.findByText("C commit");
  await settle();
  await captureDocument(document, {
    name: "stack-chaos-mutate-01-archive-middle",
    expectations: [
      "mid/c stays stacked under mid/a in the sidebar after mid/b is archived.",
      "The header target for mid/c names its real parent, not the default branch.",
      "Commits tab for mid/c lists only commits that belong to the stack's remaining branches.",
    ],
  });
}, 180000);

// Chaos: "Before" on the stack root, then reorder the root onto its grandchild.
it("stack chaos: before on the root and a grandchild reorder", async () => {
  const { repoPath, defaultBranch } = createTestRepo(false);
  openRepo(repoPath);
  const user = userEvent.setup();
  render(<Dashboard />);

  await stackFromHome(user, "ro/a");
  await stackOn(user, "ro/a", "ro/b");
  await stackOn(user, "ro/b", "ro/c");
  // "Before" is hidden on a stack root, so insert the new base before ro/b.
  await stackOn(user, "ro/b", "ro/root", "before");

  let t = await targets(repoPath);
  chaosLog("[chaos] targets after before-insert", JSON.stringify(t));
  expect(t["ro/a"]).toBe(defaultBranch);
  expect(t["ro/root"]).toBe("ro/a");
  expect(t["ro/b"]).toBe("ro/root");

  await user.click(await findSidebarBranchElement("ro/c"));
  await screen.findByTestId("workspace-stack-panel");
  await settle();
  await captureDocument(document, {
    name: "stack-chaos-mutate-02-before-root",
    expectations: [
      "Sidebar nests ro/a > ro/root > ro/b > ro/c.",
      "Stack panel shows 4 workspaces above the default branch with ro/c highlighted.",
    ],
  });

  // Reorder: move ro/a onto its grandchild ro/c.
  await user.click(await findSidebarBranchElement("ro/a"));
  const targetBtn = await screen.findByRole("button", {
    name: "Workspace target",
  });
  await waitFor(() => expect(targetBtn).not.toBeDisabled());
  await user.click(targetBtn);
  await user.click(
    await screen.findByText("ro/c", { selector: ".branch-list-item *" }),
  );
  await waitFor(async () => {
    expect((await targets(repoPath))["ro/a"]).toBe("ro/c");
  });
  t = await targets(repoPath);
  chaosLog("[chaos] targets after grandchild reorder", JSON.stringify(t));
  await settle();
  await captureDocument(document, {
    name: "stack-chaos-mutate-03-grandchild-reorder",
    expectations: [
      "Every workspace is still visible in the sidebar (none vanished).",
      "The tree is acyclic: ro/a now sits below ro/c.",
    ],
  });
}, 180000);
