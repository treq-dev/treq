// @include-parallel
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { Dashboard } from "../../src/components/Dashboard";
import { render, screen, waitFor, within } from "../test-utils";
import { createWorkspace, getWorkspaces } from "../../src/lib/api";
import {
  createTestRepo,
  openRepo,
  resolveWorkspacePath,
  writeWorkspaceFile,
} from "../utils";

describe("task input @ mentions", () => {
  let user: ReturnType<typeof userEvent.setup>;
  let repoPath: string;

  beforeEach(() => {
    ({ repoPath } = createTestRepo(false));
    openRepo(repoPath);
    user = userEvent.setup();
  });

  it("suggests repo files on a freshly opened repo", async () => {
    render(<Dashboard />);
    await screen.findByTestId("show-workspace-header");
    await user.keyboard("{Meta>}i{/Meta}");
    const dialog = (
      await screen.findByRole("heading", { name: "Start a new agent session" })
    ).closest('[data-testid="modal"]') as HTMLElement;
    const textarea = within(dialog).getByPlaceholderText("Describe a task...");

    await user.type(textarea, "Update @READ");
    await user.click(
      await within(dialog).findByRole(
        "button",
        { name: "README.md" },
        { timeout: 10000 },
      ),
    );

    await waitFor(() => expect(textarea).toHaveValue("Update @README.md "));
  }, 30000);

  it("suggests files from the workspace picked in the prompt dialog", async () => {
    const workspaceId = await createWorkspace(repoPath, "feat/mentions");
    const workspace = (await getWorkspaces(repoPath)).find(
      (ws) => ws.id === workspaceId,
    )!;
    writeWorkspaceFile(
      resolveWorkspacePath(repoPath, workspace.workspace_path),
      "only-in-workspace.md",
      "hello\n",
    );

    render(<Dashboard />);
    await screen.findByTestId("show-workspace-header");
    await user.keyboard("{Meta>}i{/Meta}");
    const dialog = (
      await screen.findByRole("heading", { name: "Start a new agent session" })
    ).closest('[data-testid="modal"]') as HTMLElement;
    await user.click(
      dialog.querySelector('button[role="combobox"]') as HTMLElement,
    );
    await user.click(
      await screen.findByRole("option", { name: "feat/mentions" }),
    );

    const textarea = within(dialog).getByPlaceholderText("Describe a task...");
    await user.type(textarea, "Read @only-in");
    await user.click(
      await within(dialog).findByRole(
        "button",
        { name: "only-in-workspace.md" },
        { timeout: 10000 },
      ),
    );

    await waitFor(() =>
      expect(textarea).toHaveValue("Read @only-in-workspace.md "),
    );
  }, 30000);
});
