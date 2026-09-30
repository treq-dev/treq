import { describe, expect, it } from "vitest";
import { capabilitiesFor } from "./remote-capabilities";

describe("capabilitiesFor", () => {
  it("offers shells and agent terminals for remote repositories", () => {
    const caps = capabilitiesFor(true);
    expect(caps.shell).toEqual({ supported: true });
    expect(caps.agentPty).toEqual({ supported: true });
  });

  it("offers every action for local repositories", () => {
    const caps = capabilitiesFor(false);
    expect(Object.values(caps).every((cap) => cap.supported)).toBe(true);
  });
});
