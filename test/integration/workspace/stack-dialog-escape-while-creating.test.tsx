import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { Dashboard } from "../../../src/components/Dashboard";
import * as api from "../../../src/lib/api";
import { render, screen, waitFor, within } from "../../test-utils";
import { createTestRepo, findSidebarBranchElement, openRepo } from "../../utils";

// Holds createWorkspace open until the test releases it, so "Creating..." is
// guaranteed to be on screen when Escape is pressed.
let gate: Promise<void> | null = null;
vi.mock("../../../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/api")>();
  return {
    ...actual,
    createWorkspace: async (
      ...args: Parameters<typeof actual.createWorkspace>
    ) => {
      if (gate) await gate;
      return actual.createWorkspace(...args);
    },
  };
});

afterEach(() => {
  gate = null;
});

it("ignores Escape while a stacked workspace is being created", async () => {
  const { repoPath } = createTestRepo(false);
  openRepo(repoPath);
  await api.createWorkspace(repoPath, "esc/base");

  const user = userEvent.setup();
  render(<Dashboard />);

  const row = (await findSidebarBranchElement("esc/base")).closest(
    "div",
  ) as HTMLElement;
  await user.hover(row);
  await user.click(
    await within(row).findByRole("button", { name: "Stack a workspace" }),
  );
  const dialog = await screen.findByTestId("modal");
  await user.type(within(dialog).getByLabelText("Branch Name"), "esc/child");

  let release!: () => void;
  gate = new Promise((resolve) => {
    release = resolve;
  });
  await user.click(
    within(dialog).getByRole("button", { name: "Create Workspace" }),
  );
  await within(dialog).findByRole("button", { name: /Creating/ });

  await user.keyboard("{Escape}");
  expect(screen.getByTestId("modal")).toBeInTheDocument();

  release();
  await waitFor(() =>
    expect(screen.queryByTestId("modal")).not.toBeInTheDocument(),
  );
  await findSidebarBranchElement("esc/child");
}, 30000);
