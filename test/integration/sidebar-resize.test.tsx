import * as React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "../test-utils";
import userEvent from "@testing-library/user-event";
import { createTestRepo, openRepo } from "../utils";
import { createWorkspace } from "../../src/lib/api";
import { Dashboard } from "../../src/components/Dashboard";
import {
  DEFAULT_SIDEBAR_WIDTH,
  useSidebarWidthStore,
} from "../../src/stores/sidebarWidthStore";

describe("Dashboard - workspace sidebar resize", () => {
  let repoPath: string;
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(async () => {
    ({ repoPath } = createTestRepo(false));
    openRepo(repoPath);
    await createWorkspace(repoPath, "feat/alpha");
    user = userEvent.setup();
  });

  it("resizes the workspace sidebar by dragging the edge", async () => {
    render(<Dashboard />);
    await screen.findByText("feat/alpha");

    const wrapper = screen.getByTestId("sidebar-wrapper");
    expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe(
      `${DEFAULT_SIDEBAR_WIDTH}px`,
    );

    const handle = screen.getByRole("button", {
      name: "Resize workspace sidebar",
    });
    await user.pointer([
      {
        keys: "[MouseLeft>]",
        target: handle,
        coords: { clientX: DEFAULT_SIDEBAR_WIDTH, clientY: 80 },
      },
      { coords: { clientX: DEFAULT_SIDEBAR_WIDTH + 80, clientY: 80 } },
      { keys: "[/MouseLeft]" },
    ]);

    expect(useSidebarWidthStore.getState().width).toBe(
      DEFAULT_SIDEBAR_WIDTH + 80,
    );
    expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe(
      `${DEFAULT_SIDEBAR_WIDTH + 80}px`,
    );
  });
});
