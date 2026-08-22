/**
 * Visual QA: terminal pane chrome is an inset top-right pull, not a
 * persistent full-width "Terminals" header bar.
 */

import * as React from "react";
import { expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import {
  createTestRepo,
  findSidebarBranchElement,
  openRepo,
} from "../../../test/utils";
import { createWorkspace, getWorkspaces } from "../../../src/lib/api";
import { render, screen, waitFor } from "../../../test/test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import { captureDocument } from "../capture";

const BRANCH_NAME = "feat/terminal-inset-controls";

it("pane expand/control buttons sit in an inset top-right pull", async () => {
  const { repoPath } = createTestRepo(false);
  openRepo(repoPath);

  await createWorkspace(repoPath, BRANCH_NAME);
  const workspaces = await getWorkspaces(repoPath);
  const workspace = workspaces.find((w) => w.branch_name === BRANCH_NAME);
  if (!workspace) throw new Error(`workspace ${BRANCH_NAME} not found`);

  const user = userEvent.setup();
  render(<Dashboard />);

  await user.click(await findSidebarBranchElement(workspace.branch_name));
  await screen.findByTestId("workspace-terminal-pane");
  expect(screen.queryByText("Terminals")).not.toBeInTheDocument();
  expect(screen.getByLabelText(/Expand terminal/i)).toBeInTheDocument();

  await captureDocument(document, {
    name: "terminal-pane-inset-controls-01-collapsed",
    expectations: [
      "There is no full-width Terminals header bar across the bottom of the workspace.",
      "A small inset control pull with an expand chevron sits at the bottom-right of the main pane.",
    ],
  });

  await user.click(
    await screen.findByRole("button", { name: "New agent terminal" }),
  );
  await waitFor(() => {
    expect(
      document.querySelector('[data-terminal-id^="claude-"]'),
    ).not.toBeNull();
  });
  expect(screen.getByLabelText(/Collapse terminal/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/Maximize terminal/i)).toBeInTheDocument();

  await captureDocument(document, {
    name: "terminal-pane-inset-controls-02-expanded",
    expectations: [
      "The expanded terminal pane has no persistent Terminals title bar.",
      "Maximize and collapse buttons sit in a small inset pull at the top-right of the terminal pane.",
      "An agent terminal fills the pane under the workspace group header.",
    ],
  });
}, 60000);
