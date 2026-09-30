import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, render, screen } from "../../test/test-utils";
import {
  RemoteTerminalPanel,
  type RemoteTerminalTarget,
} from "./RemoteTerminalPanel";
import * as apiExtra from "../lib/api-extra";
import type { RemotePtyExitPayload } from "../lib/api-extra";
import type { SshEndpoint } from "../lib/api-types-remote";

vi.mock("../lib/remote-dispatch", async () => {
  const actual = await vi.importActual("../lib/remote-dispatch");
  return { ...actual, dispatchOverSsh: vi.fn().mockResolvedValue(null) };
});

vi.mock("../lib/api-extra", async () => {
  const actual = await vi.importActual("../lib/api-extra");
  return {
    ...actual,
    remotePtyListPersistentSessions: vi.fn(),
    remotePtyCreate: vi.fn().mockResolvedValue(undefined),
    remotePtyReattach: vi.fn().mockResolvedValue(undefined),
    remotePtyListen: vi.fn().mockResolvedValue(() => {}),
    remotePtyListenExit: vi.fn(),
    remotePtyClose: vi.fn().mockResolvedValue(undefined),
    remotePtyResize: vi.fn().mockResolvedValue(undefined),
    remotePtyWrite: vi.fn().mockResolvedValue(undefined),
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

const target: RemoteTerminalTarget = {
  endpoint,
  repositoryId: "/srv/project",
  workspaceId: "feature",
  remoteWorkingDirectory: "/srv/project/.treq/workspaces/feature",
  label: "claude-abc",
  launch: { type: "agent", agent: "claude", args: [] },
  reattach: false,
};

/** Exit callbacks registered per local session id, to simulate a channel ending. */
let exitCallbacks: Map<string, (payload: RemotePtyExitPayload) => void>;

const attachedSessionIds = () =>
  vi.mocked(apiExtra.remotePtyReattach).mock.calls.map((call) => call[0]);

beforeEach(() => {
  vi.clearAllMocks();
  exitCallbacks = new Map();
  vi.mocked(apiExtra.remotePtyListenExit).mockImplementation(
    async (sessionId, callback) => {
      exitCallbacks.set(sessionId, callback);
      return () => {};
    },
  );
  vi.mocked(apiExtra.remotePtyReattach).mockResolvedValue(undefined);
});

const endChannel = async (sessionId: string) => {
  await act(async () => {
    exitCallbacks.get(sessionId)?.({ exit_status: null });
  });
};

describe("RemoteTerminalPanel", () => {
  it("starts new sessions through the persistent supervisor with the requested launch", async () => {
    render(<RemoteTerminalPanel target={target} onClose={() => {}} />);

    await vi.waitFor(() =>
      expect(apiExtra.remotePtyReattach).toHaveBeenCalledTimes(1),
    );
    expect(apiExtra.remotePtyReattach).toHaveBeenCalledWith(
      expect.any(String),
      endpoint,
      "/srv/project",
      "feature",
      "claude-abc",
      "/srv/project/.treq/workspaces/feature",
      { type: "agent", agent: "claude", args: [] },
      expect.any(Number),
      expect.any(Number),
    );
    expect(apiExtra.remotePtyCreate).not.toHaveBeenCalled();
    // Output listeners are attached before the session so the first screen
    // redraw is not lost.
    expect(
      vi.mocked(apiExtra.remotePtyListen).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(apiExtra.remotePtyReattach).mock.invocationCallOrder[0],
    );
  });

  it("reattaches automatically once when the channel drops but the session is still running", async () => {
    vi.mocked(apiExtra.remotePtyListPersistentSessions).mockResolvedValue([
      {
        session_name: "treq-pty-x",
        workspace: "feature",
        label: "claude-abc",
        running: true,
      },
    ]);
    render(<RemoteTerminalPanel target={target} onClose={() => {}} />);
    await vi.waitFor(() => expect(attachedSessionIds()).toHaveLength(1));

    await endChannel(attachedSessionIds()[0]);
    await vi.waitFor(() => expect(attachedSessionIds()).toHaveLength(2));
    expect(apiExtra.remotePtyListPersistentSessions).toHaveBeenCalledWith(
      endpoint,
      "/srv/project",
      "feature",
    );
    // Same persistent label, new local channel id.
    expect(vi.mocked(apiExtra.remotePtyReattach).mock.calls[1][4]).toBe(
      "claude-abc",
    );
    expect(attachedSessionIds()[1]).not.toBe(attachedSessionIds()[0]);

    // A second drop straight away waits for the user instead of looping.
    await endChannel(attachedSessionIds()[1]);
    expect(
      await screen.findByText(/Connection to the remote session was lost/),
    ).toBeTruthy();
    expect(attachedSessionIds()).toHaveLength(2);
  });

  it("offers a manual reattach when the host cannot be reached", async () => {
    vi.mocked(apiExtra.remotePtyListPersistentSessions).mockRejectedValue(
      new Error("connection reset"),
    );
    const user = userEvent.setup();
    render(<RemoteTerminalPanel target={target} onClose={() => {}} />);
    await vi.waitFor(() => expect(attachedSessionIds()).toHaveLength(1));

    await endChannel(attachedSessionIds()[0]);
    await user.click(await screen.findByRole("button", { name: "Reattach" }));

    await vi.waitFor(() => expect(attachedSessionIds()).toHaveLength(2));
    expect(vi.mocked(apiExtra.remotePtyReattach).mock.calls[1][4]).toBe(
      "claude-abc",
    );
  });

  it("reports the session as ended when it is no longer running on the host", async () => {
    vi.mocked(apiExtra.remotePtyListPersistentSessions).mockResolvedValue([]);
    render(<RemoteTerminalPanel target={target} onClose={() => {}} />);
    await vi.waitFor(() => expect(attachedSessionIds()).toHaveLength(1));

    await endChannel(attachedSessionIds()[0]);

    expect(await screen.findByText(/session ended/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reattach" })).toBeNull();
    expect(attachedSessionIds()).toHaveLength(1);
  });
});
