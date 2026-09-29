// @include-parallel
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { render, waitFor } from "../test-utils";
import { Dashboard } from "../../src/components/Dashboard";
import { createTestRepo, openRepo } from "../utils";
import { createWorkspace, getSessions } from "../../src/lib/api";

async function fireDeepLink(payload: string[]) {
  await waitFor(() =>
    expect(
      vi
        .mocked(listen)
        .mock.calls.filter((args) => args[0] === "deep-link-received").length,
    ).toBeGreaterThanOrEqual(2),
  );
  const callbacks = vi
    .mocked(listen)
    .mock.calls.filter((args) => args[0] === "deep-link-received")
    .map((args) => args[1] as (event: { payload: string[] }) => unknown);
  await Promise.all(callbacks.map((callback) => callback({ payload })));
}

describe("agent deep-link integration", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("creates a workspace agent session from treq://agent/start and ignores duplicate request_id", async () => {
    const { repoPath } = createTestRepo(false);
    openRepo(repoPath);
    const workspaceId = await createWorkspace(repoPath, "feat/agent-link");

    render(<Dashboard />);

    const url = `treq://agent/start?repo=${encodeURIComponent(
      repoPath,
    )}&branch=feat%2Fagent-link&prompt=${encodeURIComponent(
      "Investigate regression",
    )}&mode=edit&agent=codex&request_id=req-link-1`;

    await fireDeepLink([url]);
    await waitFor(async () => {
      const sessions = await getSessions(repoPath);
      expect(sessions.some((s) => s.workspace_id === workspaceId)).toBe(true);
    });
    const sessionCountAfterFirst = (await getSessions(repoPath)).length;

    await fireDeepLink([url]);
    await waitFor(async () => {
      const sessions = await getSessions(repoPath);
      expect(sessions.length).toBe(sessionCountAfterFirst);
    });
  });

  it("opens a new window for links targeting another repo", async () => {
    const { repoPath } = createTestRepo(false);
    const { repoPath: otherRepoPath } = createTestRepo(false);
    openRepo(repoPath);
    render(<Dashboard />);

    const url = `treq://agent/start?repo=${encodeURIComponent(
      otherRepoPath,
    )}&branch=feat%2Fmissing&prompt=hello&mode=plan&agent=claude&request_id=req-link-2`;
    await fireDeepLink([url]);

    await waitFor(() => expect(WebviewWindow).toHaveBeenCalled());
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith(
      "acknowledge_agent_dispatch",
      expect.objectContaining({ requestId: "req-link-2" }),
    );
  });

  it("rejects a request for a missing workspace", async () => {
    const { repoPath } = createTestRepo(false);
    openRepo(repoPath);
    await createWorkspace(repoPath, "feat/existing");
    render(<Dashboard />);
    await fireDeepLink([
      `treq://agent/start?repo=${encodeURIComponent(repoPath)}&branch=missing&prompt=hello&mode=plan&agent=claude&request_id=req-missing`,
    ]);
    await waitFor(() =>
      expect(vi.mocked(invoke)).toHaveBeenCalledWith(
        "acknowledge_agent_dispatch",
        expect.objectContaining({
          requestId: "req-missing",
          status: "rejected",
        }),
      ),
    );
  });

  it("rejects when agent session creation fails", async () => {
    const { repoPath } = createTestRepo(false);
    openRepo(repoPath);
    await createWorkspace(repoPath, "feat/failure");
    render(<Dashboard />);
    const invokeMock = vi.mocked(invoke);
    const originalInvoke = invokeMock.getMockImplementation();
    expect(originalInvoke).toBeTruthy();
    invokeMock.mockImplementation((cmd, args) =>
      cmd === "create_session"
        ? Promise.reject(new Error("session creation failed"))
        : originalInvoke!(cmd, args),
    );
    await fireDeepLink([
      `treq://agent/start?repo=${encodeURIComponent(repoPath)}&branch=feat%2Ffailure&prompt=hello&mode=edit&agent=codex&request_id=req-failure`,
    ]);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "acknowledge_agent_dispatch",
        expect.objectContaining({
          requestId: "req-failure",
          status: "rejected",
          reason: "session creation failed",
        }),
      ),
    );
    invokeMock.mockImplementation(originalInvoke!);
  });
});
