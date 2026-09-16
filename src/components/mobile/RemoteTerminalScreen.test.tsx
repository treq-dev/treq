import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen } from "../../../test/test-utils";
import { RemoteTerminalScreen } from "./RemoteTerminalScreen";
import * as remoteDispatch from "../../lib/remote-dispatch";
import * as apiExtra from "../../lib/api-extra";
import type { SshEndpoint } from "../../lib/api-types-remote";

vi.mock("../../lib/remote-dispatch", async () => {
  const actual = await vi.importActual("../../lib/remote-dispatch");
  return { ...actual, dispatchOverSsh: vi.fn() };
});

vi.mock("../../lib/api-extra", async () => {
  const actual = await vi.importActual("../../lib/api-extra");
  return {
    ...actual,
    remotePtyListPersistentSessions: vi.fn(),
    remotePtyCreate: vi.fn().mockResolvedValue(undefined),
    remotePtyReattach: vi.fn().mockResolvedValue(undefined),
    remotePtyListen: vi.fn().mockResolvedValue(() => {}),
    remotePtyListenExit: vi.fn().mockResolvedValue(() => {}),
    remotePtyClose: vi.fn().mockResolvedValue(undefined),
  };
});

const endpoint: SshEndpoint = {
  id: "ep1",
  instance_id: null,
  source: { type: "user_managed" },
  hostname: "vm.example.com",
  port: 22,
  username: "treq",
  host_keys: [],
  authentication: { type: "public_key", key_reference: "key1" },
};

const WORKSPACE_PATH = "/srv/project/.treq-workspaces/feature-branch";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(remoteDispatch.dispatchOverSsh).mockImplementation(
    async (_endpoint, request) => {
      if (request.kind === "ListWorkspaces") {
        return [
          {
            id: 1,
            repo_path: "/srv/project",
            workspace_name: "feature-branch",
            workspace_path: WORKSPACE_PATH,
            branch_name: "feature-branch",
            created_at: "2024-01-01T00:00:00Z",
            title: "feature-branch",
            not_on_remote: false,
          },
        ] as never;
      }
      throw new Error(`unexpected dispatch: ${request.kind}`);
    },
  );
  vi.mocked(apiExtra.remotePtyListPersistentSessions).mockResolvedValue([]);
});

describe("RemoteTerminalScreen", () => {
  it("opens a new session in the workspace's own checkout directory, not the repo root", async () => {
    const user = userEvent.setup();
    render(
      <RemoteTerminalScreen
        endpoint={endpoint}
        repo="/srv/project"
        workspace="feature-branch"
      />,
    );

    const startButton = await screen.findByText("Start new session");
    await user.click(startButton);

    expect(apiExtra.remotePtyCreate).toHaveBeenCalledWith(
      expect.any(String),
      endpoint,
      "/srv/project",
      "feature-branch",
      WORKSPACE_PATH,
      expect.anything(),
      expect.any(Number),
      expect.any(Number),
    );
  });
});
