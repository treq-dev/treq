import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestRepo,
  findSidebarBranchElement,
  openRepo,
} from "../../utils";
import { createWorkspace, getWorkspaces } from "../../../src/lib/api";
import { render, screen, waitFor, within } from "../../test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import userEvent from "@testing-library/user-event";

async function setupWorkspace(branchName: string) {
  const { repoPath } = createTestRepo(false);
  openRepo(repoPath);
  const workspaceId = await createWorkspace(repoPath, branchName);
  const workspaces = await getWorkspaces(repoPath);
  const workspace = workspaces.find((w) => w.id === workspaceId);
  if (!workspace) throw new Error(`Workspace not found for id ${workspaceId}`);
  return { workspace };
}

describe("WorkspaceTerminalPane integration", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
  });

  it("creates new agent and shell terminals via keyboard shortcuts", async () => {
    const { workspace } = await setupWorkspace("feat/terminal-shortcuts");

    render(<Dashboard />);
    await user.click(await findSidebarBranchElement(workspace.branch_name));
    await screen.findByTestId("workspace-terminal-pane");
    expect(screen.queryByText("Terminals")).not.toBeInTheDocument();
    expect(screen.getByTestId("terminal-pane-controls")).toBeInTheDocument();
    expect(screen.getByLabelText(/Expand terminal/i)).toBeInTheDocument();

    await user.keyboard("{Meta>}]{/Meta}");
    await waitFor(() => {
      expect(
        document.querySelector('[data-terminal-id^="claude-"]'),
      ).not.toBeNull();
    });

    await user.keyboard("{Meta>}\\{/Meta}");
    await waitFor(() => {
      expect(
        document.querySelector('[data-terminal-id^="shell-"]'),
      ).not.toBeNull();
    });
  });

  it("minimizes, maximizes, and restores the terminal pane", async () => {
    const { workspace } = await setupWorkspace("feat/terminal-resize");

    render(<Dashboard />);
    await user.click(await findSidebarBranchElement(workspace.branch_name));
    await screen.findByTestId("workspace-terminal-pane");

    await user.keyboard("{Meta>}]{/Meta}");
    await waitFor(() => {
      expect(
        document.querySelector('[data-terminal-id^="claude-"]'),
      ).not.toBeNull();
    });

    await screen.findByLabelText(/Collapse terminal/i);

    await user.click(screen.getByLabelText(/Collapse terminal/i));
    await screen.findByLabelText(/Expand terminal/i);

    await user.keyboard("{Meta>}{Control>}j{/Control}{/Meta}");
    await waitFor(() => {
      expect(screen.getByLabelText(/Restore terminal/i)).toBeInTheDocument();
    });
    expect(screen.queryByLabelText(/Expand terminal/i)).not.toBeInTheDocument();

    await user.keyboard("{Meta>}{Control>}j{/Control}{/Meta}");
    await waitFor(() => {
      expect(screen.getByLabelText(/Maximize terminal/i)).toBeInTheDocument();
    });
    expect(
      screen.queryByLabelText(/Restore terminal/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Expand terminal/i)).not.toBeInTheDocument();

    await user.keyboard("{Meta>}{Control>}j{/Control}{/Meta}");
    await waitFor(() => {
      expect(screen.getByLabelText(/Restore terminal/i)).toBeInTheDocument();
    });
    expect(
      screen.queryByLabelText(/Maximize terminal/i),
    ).not.toBeInTheDocument();
  });

  it("closes an agent terminal", async () => {
    const { workspace } = await setupWorkspace("feat/terminal-close");

    render(<Dashboard />);
    await user.click(await findSidebarBranchElement(workspace.branch_name));
    await screen.findByTestId("workspace-terminal-pane");

    await user.keyboard("{Meta>}]{/Meta}");

    const terminalPanel = await waitFor(() => {
      const el = document.querySelector('[data-terminal-id^="claude-"]');
      expect(el).not.toBeNull();
      return el as Element;
    });

    const closeButton = within(terminalPanel).getByLabelText(/close session/i);
    await user.click(closeButton);

    await waitFor(() => {
      expect(
        document.querySelector('[data-terminal-id^="claude-"]'),
      ).not.toBeInTheDocument();
    });
  });

  it("shows a scroll-to-bottom button left of the reset button", async () => {
    const { workspace } = await setupWorkspace("feat/terminal-scroll-down");

    render(<Dashboard />);
    await user.click(await findSidebarBranchElement(workspace.branch_name));
    await screen.findByTestId("workspace-terminal-pane");

    await user.keyboard("{Meta>}]{/Meta}");

    const terminalPanel = await waitFor(() => {
      const el = document.querySelector('[data-terminal-id^="claude-"]');
      expect(el).not.toBeNull();
      return el as Element;
    });

    const scrollButton =
      within(terminalPanel).getByLabelText(/scroll to bottom/i);
    const resetButton = within(terminalPanel).getByLabelText(/reset terminal/i);

    expect(scrollButton.nextElementSibling).toBe(resetButton);

    await user.click(scrollButton);
  });

  it("queues follow-up messages and shows count with editable popover", async () => {
    const { workspace } = await setupWorkspace("feat/terminal-message-queue");

    render(<Dashboard />);
    await user.click(await findSidebarBranchElement(workspace.branch_name));
    await screen.findByTestId("workspace-terminal-pane");

    await user.keyboard("{Meta>}]{/Meta}");

    const terminalPanel = await waitFor(() => {
      const el = document.querySelector('[data-terminal-id^="claude-"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    expect(
      within(terminalPanel).getByTestId("agent-message-queue"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("agent-message-queue-composer"),
    ).not.toBeInTheDocument();

    await user.click(
      within(terminalPanel).getByTestId("agent-message-queue-button"),
    );
    const composer = await screen.findByTestId("agent-message-queue-composer");
    await user.type(composer, "first queued follow-up{Enter}");
    await user.type(
      await screen.findByTestId("agent-message-queue-composer"),
      "second queued follow-up{Enter}",
    );

    expect(
      await within(terminalPanel).findByTestId("agent-message-queue-count"),
    ).toHaveTextContent("2");
    expect(
      within(terminalPanel).getByTestId("agent-message-queue-button"),
    ).toBeInTheDocument();

    const dialog = await screen.findByTestId("agent-message-queue-dialog");
    expect(dialog).toHaveAttribute("data-position", "terminal-center");
    expect(
      within(dialog).getByText("first queued follow-up"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("second queued follow-up"),
    ).toBeInTheDocument();

    const removeButtons = within(dialog).getAllByLabelText(
      /remove queued message/i,
    );
    await user.click(removeButtons[1]);

    expect(
      await within(terminalPanel).findByTestId("agent-message-queue-count"),
    ).toHaveTextContent("1");
  });

  it("double-clicking a terminal scrolls it fully into view", async () => {
    const { workspace } = await setupWorkspace("feat/terminal-dblclick-scroll");

    render(<Dashboard />);
    await user.click(await findSidebarBranchElement(workspace.branch_name));
    await screen.findByTestId("workspace-terminal-pane");

    await user.keyboard("{Meta>}]{/Meta}");
    await user.keyboard("{Meta>}\\{/Meta}");

    const shellPanel = await waitFor(() => {
      const el = document.querySelector('[data-terminal-id^="shell-"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    const scrollContainer = screen.getByTestId("terminal-scroll-container");
    expect(scrollContainer.contains(shellPanel)).toBe(true);

    const scrollBy = vi.fn();
    scrollContainer.scrollBy = scrollBy;

    vi.spyOn(scrollContainer, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 200,
      right: 400,
      width: 400,
      height: 200,
      toJSON: () => ({}),
    });
    vi.spyOn(shellPanel, "getBoundingClientRect").mockReturnValue({
      x: 250,
      y: 0,
      top: 0,
      left: 250,
      bottom: 200,
      right: 650,
      width: 400,
      height: 200,
      toJSON: () => ({}),
    });

    await user.dblClick(within(shellPanel).getByText("Shell"));

    expect(scrollBy).toHaveBeenCalledWith({
      left: 250,
      behavior: "smooth",
    });
  });
});
