import { describe, expect, it } from "vitest";
import { resolveRemoteTerminalTarget } from "./remote-terminal-target";

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
