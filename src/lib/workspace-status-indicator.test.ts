import { describe, expect, it } from "vitest";
import { getWorkspaceStatusIndicator } from "./workspace-status-indicator";

describe("getWorkspaceStatusIndicator", () => {
  it("shows nothing for a clean workspace with no working agent", () => {
    expect(
      getWorkspaceStatusIndicator({
        isConflicted: false,
        hasChanges: false,
        isAgentSessionStreaming: false,
      }),
    ).toBeNull();
  });

  it("spins a neutral indicator for a clean workspace whose agent is working", () => {
    expect(
      getWorkspaceStatusIndicator({
        isConflicted: false,
        hasChanges: false,
        isAgentSessionStreaming: true,
      }),
    ).toEqual({ color: "neutral", spin: true, label: "Agent working" });
  });

  it("keeps the change color and spins it while an agent works", () => {
    expect(
      getWorkspaceStatusIndicator({
        isConflicted: false,
        hasChanges: true,
        isAgentSessionStreaming: true,
      }),
    ).toEqual({ color: "yellow", spin: true, label: "Uncommitted changes" });
    expect(
      getWorkspaceStatusIndicator({
        isConflicted: true,
        hasChanges: true,
        isAgentSessionStreaming: false,
      }),
    ).toEqual({ color: "red", spin: false, label: "Conflicted workspace" });
  });
});
