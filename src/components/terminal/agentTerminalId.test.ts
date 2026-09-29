import { describe, expect, it } from "vitest";
import { agentSessionIdOf, agentTerminalId } from "./agentTerminalId";

describe("agent terminal ids", () => {
  it("names an agent session's column without naming the agent", () => {
    expect(agentTerminalId(12)).toBe("agent-12");
  });

  it("reads the session id back from an agent column id", () => {
    expect(agentSessionIdOf("agent-12")).toBe(12);
  });

  it("returns null for shell and unknown ids", () => {
    expect(agentSessionIdOf("shell--repo-1700000000")).toBeNull();
    expect(agentSessionIdOf("claude-12")).toBeNull();
  });
});
