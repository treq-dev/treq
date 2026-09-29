// @include-parallel
import * as React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { createTestRepo, openRepo } from "../utils";
import { render, screen, waitFor, within } from "../test-utils";
import { Dashboard } from "../../src/components/Dashboard";

async function leaveTextFields(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  const active = document.activeElement;
  if (active instanceof HTMLElement) {
    active.blur();
  }
  await user.click(document.body);
}

describe("Keyboard shortcuts reference modal", () => {
  let user: ReturnType<typeof userEvent.setup>;
  let repoPath: string;

  beforeEach(() => {
    ({ repoPath } = createTestRepo(false));
    openRepo(repoPath);
    user = userEvent.setup();
  });

  it("opens on ? and lists global shortcuts", async () => {
    render(<Dashboard />);
    await screen.findByTestId("show-workspace-header");
    await leaveTextFields(user);

    await user.keyboard("?");

    const modal = await screen.findByTestId("keyboard-shortcuts-modal");
    expect(within(modal).getByText("Keyboard shortcuts")).toBeTruthy();
    expect(within(modal).getByText("New workspace")).toBeTruthy();
    expect(within(modal).getByText("Command Palette")).toBeTruthy();
  });

  it("closes on Escape and toggles on a second ?", async () => {
    render(<Dashboard />);
    await screen.findByTestId("show-workspace-header");
    await leaveTextFields(user);

    await user.keyboard("?");
    await screen.findByTestId("keyboard-shortcuts-modal");

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(
        screen.queryByTestId("keyboard-shortcuts-modal"),
      ).not.toBeInTheDocument();
    });

    await leaveTextFields(user);
    await user.keyboard("?");
    await screen.findByTestId("keyboard-shortcuts-modal");

    await leaveTextFields(user);
    await user.keyboard("?");
    await waitFor(() => {
      expect(
        screen.queryByTestId("keyboard-shortcuts-modal"),
      ).not.toBeInTheDocument();
    });
  });

  it("does not open while typing in an input", async () => {
    render(<Dashboard />);

    await user.keyboard("{Control>}k{/Control}");
    const cmdInput = await screen.findByPlaceholderText(
      "Type a command or search...",
    );
    await user.type(cmdInput, "?");

    expect(
      screen.queryByTestId("keyboard-shortcuts-modal"),
    ).not.toBeInTheDocument();
  });
});
