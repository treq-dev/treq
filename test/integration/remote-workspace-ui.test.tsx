import * as React from "react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { Dashboard } from "../../src/components/Dashboard";
import {
  createCommit,
  createWorkspace,
  ensureWorkspaceIndexed,
  getWorkspaces,
  setSetting,
} from "../../src/lib/api";
import { useRemoteMutationFeedback } from "../../src/lib/remote-mutation-ui";
import { useRemoteCutoffStore } from "../../src/stores/remoteCutoffStore";
import { act, render, screen, waitFor, within } from "../test-utils";
import {
  createTestRepo,
  findSidebarBranchElement,
  newCommitWithParents,
  resolveChangeId,
  resolveWorkspacePath,
  writeWorkspaceFile,
} from "../utils";

async function openSavedRemoteRepo(
  repoPath: string,
  options?: { endpointId?: string; generation?: number },
) {
  const endpointId = options?.endpointId ?? "endpoint-test";
  const generation = options?.generation ?? 0;
  await setSetting(
    "last_opened_remote_repo",
    JSON.stringify({
      host: "testhost",
      path: repoPath,
      display_name: "testhost-project",
      repo_uri: `ssh://testhost${repoPath}`,
      inspection: {
        root: repoPath,
        repository_type: "jj_colocated",
        current_branch: "main",
        default_branch: "main",
        current_change_id: "",
        current_commit_id: "",
        descriptor: {
          id: `${endpointId}:${repoPath}`,
          location: { type: "ssh", host: "testhost", path: repoPath },
          display_name: "testhost-project",
        },
      },
      endpoint_id: endpointId,
      endpoint_generation: generation,
    }),
  );
}

describe("remote workspace UI", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(async () => {
    user = userEvent.setup();
    window.history.replaceState({}, "", "/");
    await setSetting("last_opened_remote_repo", "");
    useRemoteMutationFeedback.setState({
      ambiguousReason: null,
      lastStatus: null,
    });
    useRemoteCutoffStore.setState({ cutoffs: {} });
  });

  it("renders the normal workspace tree for a remote repository", async () => {
    const { repoPath, defaultBranch } = createTestRepo(false);
    await createWorkspace(repoPath, "feat/remote-ui");
    await openSavedRemoteRepo(repoPath);

    render(React.createElement(Dashboard));

    expect(await screen.findByTestId("show-workspace-header")).toBeTruthy();
    expect(screen.queryByText("Remote repository connected")).toBeNull();
    expect(screen.queryByText("Remote review")).toBeNull();
    expect(await findSidebarBranchElement("feat/remote-ui")).toBeTruthy();
    expect(
      await within(
        await screen.findByTestId("show-workspace-header"),
      ).findByRole("button", { name: defaultBranch }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
    expect(screen.getByTestId("remote-capability-notice")).toHaveTextContent(
      "native SSH PTY",
    );
  });

  it("selects a remote workspace from the sidebar", async () => {
    const { repoPath } = createTestRepo(false);
    await createWorkspace(repoPath, "feat/select-me");
    await openSavedRemoteRepo(repoPath);

    render(React.createElement(Dashboard));
    await user.click(await findSidebarBranchElement("feat/select-me"));

    const header = await screen.findByTestId("show-workspace-header");
    expect(await within(header).findByText("feat/select-me")).toBeTruthy();
  });

  it("shows remote changes, commits, and available mutations", async () => {
    const { repoPath } = createTestRepo(false);
    const workspaceId = await createWorkspace(repoPath, "feat/changes");
    const workspace = (await getWorkspaces(repoPath)).find(
      (item) => item.id === workspaceId,
    );
    if (!workspace) throw new Error("workspace missing");
    writeWorkspaceFile(
      resolveWorkspacePath(repoPath, workspace.workspace_path),
      "remote-change.txt",
      "hello remote\n",
    );
    await openSavedRemoteRepo(repoPath);

    render(React.createElement(Dashboard));
    await user.click(await findSidebarBranchElement("feat/changes"));
    await user.click(await screen.findByRole("tab", { name: /^Changes/ }));

    expect(
      (await screen.findAllByText("remote-change.txt")).length,
    ).toBeGreaterThan(0);
    await user.click(await screen.findByTitle("remote-change.txt"));
    expect(await screen.findByText(/hello remote/)).toBeTruthy();
    await user.click(await screen.findByRole("tab", { name: /^Commits/ }));
    expect(screen.getByTestId("remote-capability-notice")).toHaveTextContent(
      "Commit split is not yet available",
    );
  });

  it("shows remote conflicts in the workspace review UI", async () => {
    const { repoPath } = createTestRepo(false);
    const workspaceId = await createWorkspace(repoPath, "feat/conflict");
    const workspace = (await getWorkspaces(repoPath)).find(
      (item) => item.id === workspaceId,
    );
    if (!workspace) throw new Error("workspace missing");
    const workspacePath = resolveWorkspacePath(
      repoPath,
      workspace.workspace_path,
    );

    writeWorkspaceFile(workspacePath, "README.md", "workspace side\n");
    await createCommit(repoPath, workspaceId, "workspace conflicting change");
    const workspaceChangeId = resolveChangeId(workspacePath, "@-");

    writeWorkspaceFile(repoPath, "README.md", "main side\n");
    await createCommit(repoPath, null, "main conflicting change");
    const mainChangeId = resolveChangeId(repoPath, "@-");

    newCommitWithParents(workspacePath, [workspaceChangeId, mainChangeId]);
    await ensureWorkspaceIndexed(repoPath, workspaceId, workspacePath);
    await openSavedRemoteRepo(repoPath);

    render(React.createElement(Dashboard));
    await user.click(await findSidebarBranchElement("feat/conflict"));
    await user.click(await screen.findByRole("tab", { name: /^Changes/ }));

    expect(
      await screen.findByRole("button", { name: "Conflicts" }),
    ).toBeTruthy();
    expect((await screen.findAllByTitle("README.md")).length).toBeGreaterThan(
      0,
    );
  }, 20_000);

  it("disables shell and agent actions from remote capabilities", async () => {
    const { repoPath } = createTestRepo(false);
    await createWorkspace(repoPath, "feat/caps");
    await openSavedRemoteRepo(repoPath);

    render(React.createElement(Dashboard));
    const row = (await findSidebarBranchElement("feat/caps")).closest(
      "div",
    ) as HTMLElement;
    const shell = within(row).getByRole("button", { name: "Open shell" });
    expect(shell).toBeDisabled();
    expect(shell).toHaveAttribute("title", expect.stringContaining("PTY"));
    const agent = within(row).getByRole("button", { name: "Start agent" });
    expect(agent).toBeDisabled();
  });

  it("blocks interaction behind a credential cutoff banner", async () => {
    const { repoPath } = createTestRepo(false);
    await openSavedRemoteRepo(repoPath, { endpointId: "ep-cut" });

    render(React.createElement(Dashboard));
    await screen.findByTestId("show-workspace-header");

    act(() => {
      useRemoteCutoffStore.getState().recordCutoff("ep-cut", "key_revoked");
    });

    const banner = await screen.findByTestId("remote-status-banner");
    expect(banner).toHaveAttribute("data-state", "cutoff");
    expect(banner).toHaveTextContent("reauthenticate");
    expect(screen.getByTestId("remote-cutoff-overlay")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeDisabled();
  });

  it("explains an ambiguous mutation without retrying", async () => {
    const { repoPath } = createTestRepo(false);
    await openSavedRemoteRepo(repoPath);

    render(React.createElement(Dashboard));
    await screen.findByTestId("show-workspace-header");

    act(() => {
      useRemoteMutationFeedback.getState().report({
        status: "ambiguous",
        reason: "Could not tell whether the remote commit landed.",
      });
    });

    expect(
      await screen.findByRole("dialog", {
        name: "Remote change could not be verified",
      }),
    ).toBeTruthy();
    expect(screen.getByTestId("remote-ambiguous-reason")).toHaveTextContent(
      "Could not tell whether the remote commit landed.",
    );
  });

  it("isolates cache identity across endpoint generations", async () => {
    const { repoPath } = createTestRepo(false);
    await createWorkspace(repoPath, "feat/gen-a");
    await openSavedRemoteRepo(repoPath, {
      endpointId: "ep-a",
      generation: 1,
    });

    const { unmount } = render(React.createElement(Dashboard));
    expect(await findSidebarBranchElement("feat/gen-a")).toBeTruthy();
    unmount();

    await openSavedRemoteRepo(repoPath, {
      endpointId: "ep-a",
      generation: 2,
    });
    render(React.createElement(Dashboard));
    expect(await findSidebarBranchElement("feat/gen-a")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
  });

  it("refreshes when the workspace change marker advances", async () => {
    const { repoPath } = createTestRepo(false);
    const workspaceId = await createWorkspace(repoPath, "feat/marker");
    const workspace = (await getWorkspaces(repoPath)).find(
      (item) => item.id === workspaceId,
    );
    if (!workspace) throw new Error("workspace missing");
    await openSavedRemoteRepo(repoPath);

    render(React.createElement(Dashboard));
    await user.click(await findSidebarBranchElement("feat/marker"));
    await user.click(await screen.findByRole("tab", { name: /^Changes/ }));

    writeWorkspaceFile(
      resolveWorkspacePath(repoPath, workspace.workspace_path),
      "foreign.txt",
      "from another client\n",
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 4_100));
    });

    await waitFor(() => {
      expect(screen.getAllByText("foreign.txt").length).toBeGreaterThan(0);
    });
  }, 10_000);
});
