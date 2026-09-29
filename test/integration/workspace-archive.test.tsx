// @include-parallel
import * as React from "react";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "../test-utils";
import userEvent from "@testing-library/user-event";
import { createTestRepo, findSidebarBranchElement, openRepo } from "../utils";
import { createWorkspace, getWorkspaces } from "../../src/lib/api";
import { Dashboard } from "../../src/components/Dashboard";
import { waitFor } from "@testing-library/react";

describe("archive workspace from sidebar", () => {
  let repoPath: string;
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(async () => {
    ({ repoPath } = createTestRepo(false));
    openRepo(repoPath);
    await createWorkspace(repoPath, "feat/alpha");
    user = userEvent.setup();
  });

  it("archives a workspace without opening the delete dialog and keeps the db record", async () => {
    const { ask } = await import("@tauri-apps/plugin-dialog");
    const askSpy = vi.mocked(ask);

    const workspaces = await getWorkspaces(repoPath);
    const alphaWorkspace = workspaces.find(
      (w) => w.branch_name === "feat/alpha",
    )!;
    const workspaceDir = `${repoPath}/.treq/workspaces/${alphaWorkspace.workspace_path}`;

    render(<Dashboard />);

    const alphaElement = await findSidebarBranchElement("feat/alpha");
    fireEvent.contextMenu(alphaElement);
    await user.click(await screen.findByText("Archive Workspace"));

    await waitFor(() => {
      expect(screen.queryByText("feat/alpha")).not.toBeInTheDocument();
    });

    expect(askSpy).not.toHaveBeenCalled();
    expect(screen.queryByText("Delete Workspace")).not.toBeInTheDocument();
    expect(screen.queryByText(/delete workspace/i)).not.toBeInTheDocument();

    expect(existsSync(workspaceDir)).toBe(false);

    const remaining = await getWorkspaces(repoPath);
    expect(remaining.find((w) => w.id === alphaWorkspace.id)).toBeUndefined();

    const archived = execFileSync(
      "sqlite3",
      [
        `${repoPath}/.treq/local.db`,
        `SELECT archived FROM workspaces WHERE id = ${alphaWorkspace.id};`,
      ],
      { encoding: "utf8" },
    ).trim();
    expect(archived).toBe("1");
  });
});
