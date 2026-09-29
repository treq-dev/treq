// @include-parallel
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { Dashboard } from "../../../src/components/Dashboard";
import { createWorkspace, getWorkspaces } from "../../../src/lib/api";
import { render, screen, waitFor, within } from "../../test-utils";
import {
  createTestRepo,
  findSidebarBranchElement,
  openRepo,
} from "../../utils";

describe("create dialog branch name", () => {
  let repoPath: string;
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    ({ repoPath } = createTestRepo(false));
    openRepo(repoPath);
    user = userEvent.setup();
  });

  async function openStackDialog() {
    await user.click(await screen.findByTestId("home-repo-row"));
    await screen.findByTestId("show-workspace-header");
    await user.click(await screen.findByRole("button", { name: "Stack" }));
    return screen.findByTestId("modal");
  }

  it("rejects an invalid branch name inline before submitting", async () => {
    render(<Dashboard />);
    const dialog = await openStackDialog();

    await user.type(within(dialog).getByLabelText("Branch Name"), "feat/a b");

    expect(
      await within(dialog).findByTestId("branch-name-error"),
    ).toHaveTextContent("Invalid branch name: contains ' '");
    expect(
      within(dialog).getByRole("button", { name: "Create Workspace" }),
    ).toBeDisabled();
  });

  it("rejects a name an existing workspace already owns", async () => {
    await createWorkspace(repoPath, "feat/taken");
    render(<Dashboard />);
    await findSidebarBranchElement("feat/taken");
    const dialog = await openStackDialog();

    await user.type(within(dialog).getByLabelText("Branch Name"), "feat/taken");

    expect(
      await within(dialog).findByTestId("branch-name-error"),
    ).toHaveTextContent("A workspace for feat/taken already exists");
    expect(
      within(dialog).getByRole("button", { name: "Create Workspace" }),
    ).toBeDisabled();
  });

  it("creates the workspace with the trimmed branch name", async () => {
    render(<Dashboard />);
    await user.click(await screen.findByTestId("home-repo-row"));
    await screen.findByTestId("show-workspace-header");
    await user.click(await screen.findByRole("button", { name: "Stack" }));
    const dialog = await screen.findByTestId("modal");

    await user.type(
      within(dialog).getByLabelText("Branch Name"),
      "  feat/trim  ",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Create Workspace" }),
    );

    await findSidebarBranchElement("feat/trim");
    await waitFor(async () =>
      expect((await getWorkspaces(repoPath)).map((w) => w.branch_name)).toEqual(
        ["feat/trim"],
      ),
    );
  });
});
