import { describe, expect, it } from "vitest";
import type { AgentSessionData } from "../terminal/types";
import { resolveTerminalWorkspace } from "./resolveTerminalWorkspace";

const claude = (
  overrides: Partial<AgentSessionData> = {},
): AgentSessionData => ({
  sessionId: 1,
  sessionName: "agent",
  ptySessionId: "pty-1",
  workspacePath: "/tmp/ws",
  repoPath: "/tmp/repo",
  workspaceName: "feat/thing",
  ...overrides,
});

describe("resolveTerminalWorkspace", () => {
  it("uses the agent session workspace name for a claude terminal", () => {
    const info = resolveTerminalWorkspace(
      { type: "agent", data: claude() },
      { agentSessions: [], currentBranch: "main" },
    );
    expect(info).toEqual({
      workspaceKey: "/tmp/ws",
      workspaceName: "feat/thing",
      isMainRepo: false,
    });
  });

  it("falls back to the current branch for a main-repo agent terminal", () => {
    const info = resolveTerminalWorkspace(
      {
        type: "agent",
        data: claude({
          workspacePath: null,
          workspaceName: null,
        }),
      },
      { agentSessions: [], currentBranch: "develop" },
    );
    expect(info.workspaceKey).toBe("/tmp/repo");
    expect(info.workspaceName).toBe("develop");
    expect(info.isMainRepo).toBe(true);
  });

  it("resolves a shell terminal from the workspace path map", () => {
    const info = resolveTerminalWorkspace(
      { type: "shell", data: { id: "shell-1", workingDirectory: "/tmp/ws" } },
      {
        agentSessions: [],
        workspaceBranchByPath: new Map([["/tmp/ws", "feat/shell"]]),
        currentBranch: "main",
      },
    );
    expect(info).toEqual({
      workspaceKey: "/tmp/ws",
      workspaceName: "feat/shell",
      isMainRepo: false,
    });
  });
});
