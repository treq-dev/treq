import * as React from "react";
import { invoke } from "@tauri-apps/api/core";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "../../src/components/Dashboard";
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspaces,
} from "../../src/lib/api";
import { invalidateQueries } from "../../src/lib/swr-cache";
import { fireEvent, render, screen, waitFor } from "../test-utils";
import { createTestRepo, findSidebarBranchElement, openRepo } from "../utils";

describe("leaving a workspace when workspaces are removed", () => {
  let repoPath: string;
  let alphaId: number;
  let betaId: number;
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(async () => {
    ({ repoPath } = createTestRepo(false));
    openRepo(repoPath);
    alphaId = await createWorkspace(repoPath, "feat/alpha");
    betaId = await createWorkspace(repoPath, "feat/beta");
    user = userEvent.setup();
  });

  async function openWorkspace(branch: string) {
    await user.click(await findSidebarBranchElement(branch));
    await waitFor(() =>
      expect(screen.getByTestId("show-workspace-header")).toHaveTextContent(
        branch,
      ),
    );
  }

  it("keeps the open workspace when another one is archived", async () => {
    render(<Dashboard />);
    await openWorkspace("feat/beta");

    fireEvent.contextMenu(await findSidebarBranchElement("feat/alpha"));
    await user.click(await screen.findByText("Archive Workspace"));

    await waitFor(() =>
      expect(
        screen.queryByTestId("workspace-sidebar-item-feat/alpha"),
      ).toBeNull(),
    );
    expect(screen.getByTestId("show-workspace-header")).toHaveTextContent(
      "feat/beta",
    );
  });

  it("leaves the open workspace when it is removed outside the app", async () => {
    render(<Dashboard />);
    await openWorkspace("feat/alpha");

    await deleteWorkspace(repoPath, alphaId);
    await invalidateQueries(["workspaces", repoPath]);

    await waitFor(() =>
      expect(screen.getByTestId("show-workspace-header")).not.toHaveTextContent(
        "feat/alpha",
      ),
    );
  });

  it("refreshes the sidebar for the archives that succeed when one fails", async () => {
    const originalInvoke = vi.mocked(invoke).getMockImplementation();
    vi.mocked(invoke).mockImplementation(async (cmd, args) => {
      if (
        cmd === "archive_workspace" &&
        (args as { id: number }).id === betaId
      ) {
        throw new Error("archive refused");
      }
      return originalInvoke!(cmd, args);
    });

    try {
      render(<Dashboard />);
      const alpha = await screen.findByTestId(
        "workspace-sidebar-item-feat/alpha",
      );
      const beta = await screen.findByTestId(
        "workspace-sidebar-item-feat/beta",
      );
      await user.keyboard("{Meta>}");
      await user.click(alpha);
      await user.click(beta);
      await user.keyboard("{/Meta}");
      await user.click(await screen.findByText(/archive 2 workspaces/i));

      expect(await screen.findByText(/archive refused/)).toBeInTheDocument();
      await waitFor(() =>
        expect(
          screen.queryByTestId("workspace-sidebar-item-feat/alpha"),
        ).toBeNull(),
      );
      expect(
        screen.getByTestId("workspace-sidebar-item-feat/beta"),
      ).toBeInTheDocument();
      expect((await getWorkspaces(repoPath)).map((w) => w.id)).toEqual([
        betaId,
      ]);
    } finally {
      vi.mocked(invoke).mockImplementation(originalInvoke!);
    }
  });
});
