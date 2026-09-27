import userEvent from "@testing-library/user-event";
import * as React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { Dashboard } from "../../src/components/Dashboard";
import { getWorkspaces } from "../../src/lib/api";
import { render, screen, waitFor, within } from "../test-utils";
import { createTestRepo, openRepo } from "../utils";

async function stackFromHome(
  user: ReturnType<typeof userEvent.setup>,
  branchName: string,
) {
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

describe("Stack from the home repo", () => {
  let repoPath: string;
  let defaultBranch: string;
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    ({ repoPath, defaultBranch } = createTestRepo(false));
    openRepo(repoPath);
    user = userEvent.setup();
  });

  it("creates only the requested workspace, not one for the home branch", async () => {
    render(<Dashboard />);

    await stackFromHome(user, "feat/first");

    const branches = (await getWorkspaces(repoPath)).map((w) => w.branch_name);
    expect(branches).toEqual(["feat/first"]);
    expect(branches).not.toContain(defaultBranch);
  });

  it("stacks a second workspace from home without an already-registered error", async () => {
    render(<Dashboard />);

    await stackFromHome(user, "feat/first");
    await stackFromHome(user, "feat/second");

    const branches = (await getWorkspaces(repoPath))
      .map((w) => w.branch_name)
      .sort();
    expect(branches).toEqual(["feat/first", "feat/second"]);
  });
});
