// @include-parallel
import { beforeEach, describe, expect, it } from "vitest";
import { render } from "../test-utils";
import { createTestRepo, findSidebarBranchElement, openRepo } from "../utils";
import { createWorkspace } from "../../src/lib/api";
import { Dashboard } from "../../src/components/Dashboard";
import { within } from "@testing-library/react";

describe("workspace sidebar hover actions", () => {
  beforeEach(async () => {
    const { repoPath } = createTestRepo(false);
    openRepo(repoPath);
    await createWorkspace(repoPath, "feat/alpha");
  });

  it("hides workspace action buttons until the workspace row is hovered", async () => {
    render(<Dashboard />);

    const alphaLabel = await findSidebarBranchElement("feat/alpha");
    const alphaRow = alphaLabel.closest("div") as HTMLElement;

    expect(alphaRow).toHaveClass("group/workspace");
    const agentButton = within(alphaRow).getByRole("button", {
      name: "Start agent",
    });
    const actions = agentButton.parentElement as HTMLElement;
    expect(actions).toHaveClass("hidden");
    expect(actions.className).toContain("group-hover/workspace:flex");
    expect(actions.className).toContain("group-focus-within/workspace:flex");
    expect(
      within(alphaRow).getByRole("button", { name: "Open shell" }),
    ).toBeTruthy();
    expect(
      within(alphaRow).getByRole("button", { name: "Stack a workspace" }),
    ).toBeTruthy();
  });

  it("keeps the action group out of absolute positioning and matches the home row's fixed edge padding, not a wider reservation for actions", async () => {
    render(<Dashboard />);

    const alphaLabel = await findSidebarBranchElement("feat/alpha");
    const alphaRow = alphaLabel.closest("div") as HTMLElement;

    expect(alphaRow.className).toMatch(/\bpr-2\b/);
    expect(alphaRow.className).not.toMatch(/\bpr-(?!2\b)\d/);

    const agentButton = within(alphaRow).getByRole("button", {
      name: "Start agent",
    });
    const actions = agentButton.parentElement as HTMLElement;
    expect(actions.className).not.toContain("absolute");
  });

  it("keeps a fixed row height when hover actions become visible", async () => {
    render(<Dashboard />);

    const alphaLabel = await findSidebarBranchElement("feat/alpha");
    const alphaRow = alphaLabel.closest("div") as HTMLElement;

    expect(alphaRow).toHaveClass("h-8");
  });
});
