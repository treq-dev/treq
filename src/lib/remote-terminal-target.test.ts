import { describe, expect, it } from "vitest";
import {
  newRemoteSessionLabel,
  remoteAgentIdFor,
  remoteLaunchFor,
  resolveRemoteTerminalTarget,
} from "./remote-terminal-target";

const REPO_ROOT = "/srv/project";
const WORKSPACE_PATH = "/srv/project/.treq-workspaces/feature-branch";

describe("resolveRemoteTerminalTarget", () => {
  it("opens the terminal in the selected workspace's own checkout directory, not the repo root", () => {
    const target = resolveRemoteTerminalTarget(REPO_ROOT, {
      workspace_name: "feature-branch",
      workspace_path: WORKSPACE_PATH,
    });

    expect(target).toEqual({
      workspaceId: "feature-branch",
      remoteWorkingDirectory: WORKSPACE_PATH,
    });
  });

  it("falls back to the repo root with a 'root' workspace id when no workspace is selected", () => {
    const target = resolveRemoteTerminalTarget(REPO_ROOT, null);

    expect(target).toEqual({
      workspaceId: "root",
      remoteWorkingDirectory: REPO_ROOT,
    });
  });
});

describe("remote session launch helpers", () => {
  it("maps sidebar agents onto the remote allow-list", () => {
    expect(remoteAgentIdFor("claude")).toBe("claude");
    expect(remoteAgentIdFor("codex")).toBe("codex");
    expect(remoteAgentIdFor("cursor")).toBe("cursor_agent");
    expect(remoteAgentIdFor("copilot")).toBeNull();
  });

  it("launches the agent binary as a typed spec, or a login shell", () => {
    expect(remoteLaunchFor("codex")).toEqual({
      type: "agent",
      agent: "codex",
      args: [],
    });
    expect(remoteLaunchFor(null)).toEqual({ type: "shell" });
  });

  it("builds distinct labels prefixed with the session kind", () => {
    const first = newRemoteSessionLabel(null, 1_000);
    const second = newRemoteSessionLabel(null, 2_000);
    expect(first).toMatch(/^shell-/);
    expect(newRemoteSessionLabel("claude", 1_000)).toMatch(/^claude-/);
    expect(first).not.toBe(second);
  });
});
