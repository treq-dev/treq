import { beforeEach, describe, expect, it, vi } from "vitest";
import { listen } from "@tauri-apps/api/event";
import * as api from "../../../src/lib/api";
import { createWorkspace, getWorkspaces } from "../../../src/lib/api";
import { render, screen, waitFor } from "../../test-utils";
import { Dashboard } from "../../../src/components/Dashboard";
import userEvent from "@testing-library/user-event";
import {
  createTestRepo,
  findSidebarBranchElement,
  openRepo,
} from "../../utils";
import { TREQ_SEND_EVENT } from "../../../src/lib/treqSend";

describe("treq send --browser integration", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
  });

  it("opens the Browser view and navigates when a browser send event arrives", async () => {
    const { repoPath } = createTestRepo(false);
    openRepo(repoPath);
    const workspaceId = await createWorkspace(repoPath, "feat/browser-send");
    const workspace = (await getWorkspaces(repoPath)).find(
      (item) => item.id === workspaceId,
    );
    if (!workspace) throw new Error("workspace not found");

    vi.spyOn(api, "openBrowserWebview").mockResolvedValue(undefined);
    vi.spyOn(api, "navigateBrowserWebview").mockResolvedValue(undefined);
    vi.spyOn(api, "closeBrowserWebview").mockResolvedValue(undefined);
    vi.spyOn(api, "setBrowserSelectMode").mockResolvedValue(undefined);
    vi.spyOn(api, "syncBrowserWebviewBounds").mockResolvedValue(undefined);
    vi.spyOn(api, "listenBrowserElementPicked").mockImplementation(() =>
      Promise.resolve(() => {}),
    );
    vi.spyOn(api, "listenBrowserUrlChanged").mockImplementation(() =>
      Promise.resolve(() => {}),
    );

    render(<Dashboard />);
    await user.click(await findSidebarBranchElement(workspace.branch_name));

    const listenMock = vi.mocked(listen);
    const call = listenMock.mock.calls.find(
      ([eventName]) => eventName === TREQ_SEND_EVENT,
    );
    expect(call).toBeTruthy();
    const handler = call![1] as (event: { payload: unknown }) => void;

    handler({
      payload: {
        kind: "send",
        request_id: "send-browser-1",
        repo: repoPath,
        media_type: "browser",
        path: "http://localhost:5173/preview",
        title: "http://localhost:5173/preview",
      },
    });

    await screen.findByRole("tab", { name: /^Changes/, selected: true });
    await waitFor(() => {
      expect(api.openBrowserWebview).toHaveBeenCalledWith(
        "http://localhost:5173/preview",
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
      );
    });
  });
});
