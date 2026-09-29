import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLinearAutoKickoff } from "./useLinearAutoKickoff";

const { mockStartPolling } = vi.hoisted(() => ({
  mockStartPolling: vi.fn(),
}));

vi.mock("../lib/api-linear", () => ({
  linearStartAutoKickoffPolling: mockStartPolling,
}));

vi.mock("../lib/linear-proxy-auth", () => ({
  ensureLinearProxySessionSync: () => Promise.resolve(),
}));

describe("useLinearAutoKickoff", () => {
  beforeEach(() => {
    mockStartPolling.mockReset().mockResolvedValue(undefined);
  });

  it("registers the open repo with the kickoff poller", async () => {
    renderHook(() => useLinearAutoKickoff("/repo", true));
    await vi.waitFor(() =>
      expect(mockStartPolling).toHaveBeenCalledWith("/repo"),
    );
  });

  it("registers again when the open repo changes", async () => {
    const { rerender } = renderHook(
      ({ path }) => useLinearAutoKickoff(path, true),
      { initialProps: { path: "/repo-a" } },
    );
    rerender({ path: "/repo-b" });
    await vi.waitFor(() =>
      expect(mockStartPolling).toHaveBeenLastCalledWith("/repo-b"),
    );
  });

  it("does nothing when the integration is disabled or no repo is open", () => {
    renderHook(() => useLinearAutoKickoff("/repo", false));
    renderHook(() => useLinearAutoKickoff("", true));
    expect(mockStartPolling).not.toHaveBeenCalled();
  });

  it("swallows registration errors", async () => {
    mockStartPolling.mockRejectedValue(new Error("feature disabled"));
    renderHook(() => useLinearAutoKickoff("/repo", true));
    await vi.waitFor(() => expect(mockStartPolling).toHaveBeenCalledOnce());
  });
});
