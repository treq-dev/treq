import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRemoteMutationFeedback } from "./remote-mutation-ui";

vi.mock("./swr-cache", () => ({
  invalidateQueries: vi.fn(() => Promise.resolve()),
}));

import { invalidateQueries } from "./swr-cache";

describe("useRemoteMutationFeedback", () => {
  beforeEach(() => {
    vi.mocked(invalidateQueries).mockClear();
    useRemoteMutationFeedback.setState({
      ambiguousReason: null,
      lastStatus: null,
    });
  });

  it("refreshes repository data for applied and already_applied", () => {
    useRemoteMutationFeedback.getState().report({
      status: "applied",
      value: "ok",
    });
    expect(invalidateQueries).toHaveBeenCalled();
    expect(useRemoteMutationFeedback.getState().ambiguousReason).toBeNull();

    vi.mocked(invalidateQueries).mockClear();
    useRemoteMutationFeedback.getState().report({ status: "already_applied" });
    expect(invalidateQueries).toHaveBeenCalled();
    expect(useRemoteMutationFeedback.getState().lastStatus).toBe(
      "already_applied",
    );
  });

  it("does not refresh or retry on ambiguous", () => {
    useRemoteMutationFeedback.getState().report({
      status: "ambiguous",
      reason: "unknown",
    });
    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(useRemoteMutationFeedback.getState().ambiguousReason).toBe(
      "unknown",
    );
  });
});
