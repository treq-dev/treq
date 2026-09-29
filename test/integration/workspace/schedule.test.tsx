// @include-parallel
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { Dashboard } from "../../../src/components/Dashboard";
import {
  createWorkspace,
  getWorkspaces,
  scheduleWorkspaces,
  setWorkspaceTargetBranch,
} from "../../../src/lib/api";
import { getFullWorkspacePath } from "../../../src/lib/utils";
import { render, screen, waitFor, within } from "../../test-utils";
import {
  createTestRepo,
  findSidebarBranchElement,
  openRepo,
} from "../../utils";

describe("workspace scheduling", () => {
  let repoPath: string;
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    ({ repoPath } = createTestRepo(false));
    openRepo(repoPath);
    user = userEvent.setup();
  });

  it("hides a scheduled workspace until the show-hidden toggle is on", async () => {
    await createWorkspace(repoPath, "feat/alpha");
    await createWorkspace(repoPath, "feat/beta");
    render(<Dashboard />);

    await user.click(await findSidebarBranchElement("feat/alpha"));
    const header = await screen.findByTestId("show-workspace-header");
    await user.click(
      await within(header).findByTestId("schedule-workspace-button"),
    );

    const dialog = await screen.findByTestId("schedule-workspace-dialog");
    await user.click(within(dialog).getByTestId("schedule-preset-1h"));
    await user.click(within(dialog).getByRole("button", { name: "Schedule" }));

    await waitFor(() => {
      const sidebarRoot = document.querySelector(
        `.${CSS.escape("group/sidebar")}`,
      ) as HTMLElement;
      expect(within(sidebarRoot).queryByText("feat/alpha")).toBeNull();
    });
    expect(await findSidebarBranchElement("feat/beta")).toBeTruthy();
    expect(
      await screen.findByTestId("hidden-workspace-count"),
    ).toHaveTextContent("1");

    await user.click(
      await screen.findByTestId("show-hidden-workspaces-toggle"),
    );
    expect(await findSidebarBranchElement("feat/alpha")).toBeTruthy();
  });

  it("shows a workspace again after the scheduled time has passed", async () => {
    await createWorkspace(repoPath, "feat/alpha");
    const workspaces = await getWorkspaces(repoPath);
    const alpha = workspaces.find((ws) => ws.branch_name === "feat/alpha");
    if (!alpha) throw new Error("expected feat/alpha");
    await scheduleWorkspaces(repoPath, [alpha.id], "2020-01-01T00:00:00Z");

    render(<Dashboard />);
    expect(await findSidebarBranchElement("feat/alpha")).toBeTruthy();
  });

  it("schedules an entire stack from the stack card", async () => {
    await createWorkspace(repoPath, "feat/alpha");
    await createWorkspace(repoPath, "feat/beta");
    const workspaces = await getWorkspaces(repoPath);
    const beta = workspaces.find((ws) => ws.branch_name === "feat/beta");
    if (!beta) throw new Error("expected feat/beta");
    await setWorkspaceTargetBranch(
      repoPath,
      getFullWorkspacePath(beta),
      beta.id,
      "feat/alpha",
    );

    render(<Dashboard />);
    await user.click(await findSidebarBranchElement("feat/beta"));

    const panel = await screen.findByTestId("workspace-stack-panel");
    await user.click(within(panel).getByTestId("schedule-stack-button"));

    const dialog = await screen.findByTestId("schedule-workspace-dialog");
    expect(within(dialog).getByText("Schedule stack")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Schedule" }));

    await waitFor(() => {
      const sidebarRoot = document.querySelector(
        `.${CSS.escape("group/sidebar")}`,
      ) as HTMLElement;
      expect(within(sidebarRoot).queryByText("feat/alpha")).toBeNull();
      expect(within(sidebarRoot).queryByText("feat/beta")).toBeNull();
    });
  });

  it("removes a schedule from the dialog so the workspace is visible again", async () => {
    await createWorkspace(repoPath, "feat/alpha");
    await createWorkspace(repoPath, "feat/beta");
    render(<Dashboard />);

    await user.click(await findSidebarBranchElement("feat/alpha"));
    const header = await screen.findByTestId("show-workspace-header");
    await user.click(
      await within(header).findByTestId("schedule-workspace-button"),
    );
    const dialog = await screen.findByTestId("schedule-workspace-dialog");
    await user.click(within(dialog).getByTestId("schedule-preset-1h"));
    await user.click(within(dialog).getByRole("button", { name: "Schedule" }));

    await waitFor(() => {
      const sidebarRoot = document.querySelector(
        `.${CSS.escape("group/sidebar")}`,
      ) as HTMLElement;
      expect(within(sidebarRoot).queryByText("feat/alpha")).toBeNull();
    });

    await user.click(
      await screen.findByTestId("show-hidden-workspaces-toggle"),
    );
    await user.click(await findSidebarBranchElement("feat/alpha"));

    const headerAgain = await screen.findByTestId("show-workspace-header");
    await user.click(
      await within(headerAgain).findByTestId("schedule-workspace-button"),
    );
    const rescheduleDialog = await screen.findByTestId(
      "schedule-workspace-dialog",
    );
    await user.click(
      within(rescheduleDialog).getByTestId("remove-schedule-button"),
    );

    await waitFor(() => {
      expect(screen.queryByTestId("hidden-workspace-count")).toBeNull();
    });
    expect(await findSidebarBranchElement("feat/alpha")).toBeTruthy();
    await user.click(
      await screen.findByTestId("show-hidden-workspaces-toggle"),
    );
    expect(await findSidebarBranchElement("feat/alpha")).toBeTruthy();
  });

  it("removes a schedule from the sidebar context menu", async () => {
    await createWorkspace(repoPath, "feat/alpha");
    const workspaces = await getWorkspaces(repoPath);
    const alpha = workspaces.find((ws) => ws.branch_name === "feat/alpha");
    if (!alpha) throw new Error("expected feat/alpha");
    await scheduleWorkspaces(
      repoPath,
      [alpha.id],
      new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    );

    render(<Dashboard />);
    await user.click(
      await screen.findByTestId("show-hidden-workspaces-toggle"),
    );
    const alphaElement = await findSidebarBranchElement("feat/alpha");
    await user.pointer({ keys: "[MouseRight]", target: alphaElement });
    await user.click(await screen.findByTestId("remove-schedule-menu-item"));

    await waitFor(() => {
      expect(screen.queryByTestId("hidden-workspace-count")).toBeNull();
    });
    expect(await findSidebarBranchElement("feat/alpha")).toBeTruthy();
  });
});
