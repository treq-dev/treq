import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "../test-utils";
import { waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTestRepo, findSidebarBranchElement, openRepo } from "../utils";
import { createWorkspace } from "../../src/lib/api";
import { Dashboard } from "../../src/components/Dashboard";

describe("home row context menu does not lock sidebar clicks after branch switch", () => {
  let repoPath: string;

  beforeEach(async () => {
    ({ repoPath } = createTestRepo(false));
    openRepo(repoPath);
    await createWorkspace(repoPath, "feat/alpha");
    await createWorkspace(repoPath, "feat/beta");
  });

  it("switches the home branch via Switch Branch... and still allows clicking a workspace row afterward", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    const homeRepoElement = await screen.findByTestId("home-repo-row");
    expect(within(homeRepoElement).getByText("main")).toBeTruthy();

    fireEvent.contextMenu(homeRepoElement);
    const switchBranchItem = await screen.findByText("Switch Branch...");
    await user.click(switchBranchItem);

    const modal = await screen.findByTestId("modal");
    const targetBranchOption = await within(modal).findByText("feat/beta");
    await user.click(targetBranchOption);

    await waitFor(() => {
      expect(within(homeRepoElement).getByText("feat/beta")).toBeTruthy();
    });
    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();

    expect(document.body.style.pointerEvents).not.toBe("none");

    const alphaLabel = await findSidebarBranchElement("feat/alpha");
    await user.click(alphaLabel);

    const alphaRow = alphaLabel.closest("div") as HTMLElement;
    await waitFor(() => {
      expect(alphaRow).toHaveClass("bg-primary/20");
    });
  });
});
