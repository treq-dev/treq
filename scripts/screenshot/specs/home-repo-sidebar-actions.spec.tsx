import * as React from "react";
import { expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import {
  createTestRepo,
  findSidebarBranchElement,
  openRepo,
} from "../../../test/utils";
import { render, screen, within } from "../../../test/test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import { createWorkspace } from "../../../src/lib/api";
import { captureDocument } from "../capture";

it("captures home sidebar action buttons and workspace hover-only actions", async () => {
  const { repoPath } = createTestRepo(false);
  openRepo(repoPath);

  await createWorkspace(repoPath, "feat/sibling");

  const user = userEvent.setup();
  render(<Dashboard />);

  const homeRepoElement = await screen.findByTestId("home-repo-row");
  const siblingLabel = await findSidebarBranchElement("feat/sibling");
  const siblingRow = siblingLabel.closest("div") as HTMLElement;
  await user.click(siblingLabel);

  expect(siblingRow).toHaveClass("bg-primary/20");
  expect(homeRepoElement).not.toHaveClass("bg-primary/20");
  expect(
    within(homeRepoElement).getByRole("button", { name: "Start agent" }),
  ).toBeTruthy();
  expect(
    within(homeRepoElement).getByRole("button", { name: "Open shell" }),
  ).toBeTruthy();
  expect(
    within(homeRepoElement).getByRole("button", {
      name: "Stack a workspace",
    }),
  ).toBeTruthy();
  expect(
    within(siblingRow).getByRole("button", { name: "Start agent" }),
  ).toBeTruthy();
  expect(
    within(siblingRow).getByRole("button", { name: "Open shell" }),
  ).toBeTruthy();
  expect(
    within(siblingRow).getByRole("button", { name: "Stack a workspace" }),
  ).toBeTruthy();

  await captureDocument(document, {
    name: "home-repo-sidebar-actions-01-always-visible",
    expectations: [
      "The unselected home-repo row still shows three icon buttons (agent, shell, stack) on the right.",
      "The selected feat/sibling workspace row does not show agent, shell, or stack icons until hovered.",
      "Github sits between the home row and the Workspaces list.",
    ],
  });

  await user.click(homeRepoElement);
  expect(homeRepoElement).toHaveClass("bg-primary/20");
  expect(siblingRow).not.toHaveClass("bg-primary/20");
  expect(
    within(siblingRow).getByRole("button", { name: "Start agent" }),
  ).toBeTruthy();

  await captureDocument(document, {
    name: "home-repo-sidebar-actions-02-workspace-unselected",
    expectations: [
      "The home-repo row is selected/highlighted and shows agent, shell, and stack buttons.",
      "The unselected feat/sibling workspace row hides its agent, shell, and stack buttons.",
    ],
  });

  await user.click(
    within(homeRepoElement).getByRole("button", {
      name: "Stack a workspace",
    }),
  );
  expect(await screen.findByText("Stack a new Workspace")).toBeVisible();
  expect(
    screen.getByText(
      "Create a new workspace from the current branch. Optionally move file changes.",
    ),
  ).toBeVisible();

  await captureDocument(document, {
    name: "home-repo-sidebar-actions-03-stack-dialog",
    expectations: [
      "A modal titled 'Stack a new Workspace' is open over the dashboard.",
      "The dialog description says it creates a workspace from the current branch.",
    ],
  });
}, 60000);
