import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLinearAutoKickoff } from "./useLinearAutoKickoff";

const { mockStartPolling } = vi.hoisted(() => ({
  mockStartPolling: vi.fn(),
}));

vi.mock("../lib/api-linear", () => ({
  linearStartAutoKickoffPolling: mockStartPolling,
}));

describe("useLinearAutoKickoff", () => {
  beforeEach(() => {
    mockStartPolling.mockReset().mockResolvedValue(undefined);
  });

  it("registers the open repo with the kickoff poller", () => {
    renderHook(() => useLinearAutoKickoff("/repo", true));
    expect(mockStartPolling).toHaveBeenCalledWith("/repo");
  });

  it("registers again when the open repo changes", () => {
    const { rerender } = renderHook(
      ({ path }) => useLinearAutoKickoff(path, true),
      { initialProps: { path: "/repo-a" } },
    );
    rerender({ path: "/repo-b" });
    expect(mockStartPolling).toHaveBeenLastCalledWith("/repo-b");
  });

  it("does nothing when the integration is disabled or no repo is open", () => {
    renderHook(() => useLinearAutoKickoff("/repo", false));
    renderHook(() => useLinearAutoKickoff("", true));
    expect(mockStartPolling).not.toHaveBeenCalled();
  });

  it("swallows registration errors", async () => {
    mockStartPolling.mockRejectedValue(new Error("feature disabled"));
    renderHook(() => useLinearAutoKickoff("/repo", true));
    await Promise.resolve();
    expect(mockStartPolling).toHaveBeenCalledOnce();
  });
});
