import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Mock invoke/listen to capture IPC argument mapping and event mapping
// without a real Tauri backend, mirroring the existing
// `fileWatcher.test.tsx` convention for `src/lib/api.ts`.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

describe("remote PTY API wrappers (src/lib/api-extra.ts)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("remotePtyCreate maps JS args to the exact remote_pty_create invoke payload", async () => {
    const { remotePtyCreate } = await import("./api-extra");
    const endpoint = { id: "ep-1" };
    const launch = { type: "shell" };

    await remotePtyCreate(
      "sess-1",
      endpoint,
      "repo-1",
      "workspace-1",
      "/srv/project",
      launch,
      80,
      24,
    );

    expect(invoke).toHaveBeenCalledWith("remote_pty_create", {
      sessionId: "sess-1",
      windowLabel: "main",
      endpoint,
      repositoryId: "repo-1",
      workspaceId: "workspace-1",
      remoteWorkingDirectory: "/srv/project",
      launch,
      cols: 80,
      rows: 24,
    });
  });

  it("remotePtyCreate passes a typed agent launch spec through unmodified", async () => {
    const { remotePtyCreate } = await import("./api-extra");
    const launch = { type: "agent", agent: "claude", args: ["--resume"] };

    await remotePtyCreate(
      "sess-2",
      { id: "ep-1" },
      "repo-1",
      "workspace-1",
      "/srv/project",
      launch,
      100,
      30,
    );

    expect(invoke).toHaveBeenCalledWith(
      "remote_pty_create",
      expect.objectContaining({ launch }),
    );
  });

  it("remotePtyWrite maps sessionId and data", async () => {
    const { remotePtyWrite } = await import("./api-extra");
    await remotePtyWrite("sess-1", "echo hi\n");
    expect(invoke).toHaveBeenCalledWith("remote_pty_write", {
      sessionId: "sess-1",
      data: "echo hi\n",
    });
  });

  it("remotePtyResize maps sessionId, cols, and rows", async () => {
    const { remotePtyResize } = await import("./api-extra");
    await remotePtyResize("sess-1", 120, 40);
    expect(invoke).toHaveBeenCalledWith("remote_pty_resize", {
      sessionId: "sess-1",
      cols: 120,
      rows: 40,
    });
  });

  it("remotePtyClose maps sessionId", async () => {
    const { remotePtyClose } = await import("./api-extra");
    await remotePtyClose("sess-1");
    expect(invoke).toHaveBeenCalledWith("remote_pty_close", {
      sessionId: "sess-1",
    });
  });

  it("remotePtySessionExists maps sessionId", async () => {
    const { remotePtySessionExists } = await import("./api-extra");
    await remotePtySessionExists("sess-1");
    expect(invoke).toHaveBeenCalledWith("remote_pty_session_exists", {
      sessionId: "sess-1",
    });
  });

  it("remotePtyListen subscribes to the session-suffixed data event and maps the payload", async () => {
    const { remotePtyListen } = await import("./api-extra");
    const callback = vi.fn();
    let capturedHandler: ((event: { payload: string }) => void) | undefined;
    const unsubscribe = () => {};
    vi.mocked(listen).mockImplementation((eventName, handler) => {
      expect(eventName).toBe("remote-pty-data-sess-1");
      capturedHandler = handler as (event: { payload: string }) => void;
      return Promise.resolve(unsubscribe);
    });

    await remotePtyListen("sess-1", callback);

    expect(capturedHandler).toBeDefined();
    capturedHandler?.({ payload: "hello from remote pty" });
    expect(callback).toHaveBeenCalledWith("hello from remote pty");
  });

  it("remotePtyListenExit subscribes to the session-suffixed exit event and maps the payload", async () => {
    const { remotePtyListenExit } = await import("./api-extra");
    const callback = vi.fn();
    let capturedHandler:
      | ((event: { payload: { exit_status: number | null } }) => void)
      | undefined;
    const unsubscribe = () => {};
    vi.mocked(listen).mockImplementation((eventName, handler) => {
      expect(eventName).toBe("remote-pty-exit-sess-1");
      capturedHandler = handler as (event: {
        payload: { exit_status: number | null };
      }) => void;
      return Promise.resolve(unsubscribe);
    });

    await remotePtyListenExit("sess-1", callback);

    expect(capturedHandler).toBeDefined();
    capturedHandler?.({ payload: { exit_status: 7 } });
    expect(callback).toHaveBeenCalledWith({ exit_status: 7 });
  });
});
