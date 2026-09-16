import { describe, expect, it } from "vitest";
import { autoReviewSummary, normalizeReviewAgent } from "./agent-review-launch";

describe("autoReviewSummary", () => {
  it("names the operation that started the review", () => {
    expect(autoReviewSummary("on-commit", "feature")).toContain(
      "the commit just created",
    );
    expect(autoReviewSummary("on-rebase", "feature")).toContain(
      "the rebase just applied",
    );
    expect(autoReviewSummary("on-pull", "feature")).toContain(
      "pulled from the remote",
    );
  });

  it("names the branch when there is one", () => {
    expect(autoReviewSummary("on-commit", "feature")).toContain(
      "the feature workspace diff",
    );
    expect(autoReviewSummary("on-commit", undefined)).toContain(
      "the current workspace diff",
    );
  });
});

describe("normalizeReviewAgent", () => {
  it("keeps agents a terminal session can run", () => {
    expect(normalizeReviewAgent("claude")).toBe("claude");
    expect(normalizeReviewAgent("codex")).toBe("codex");
    expect(normalizeReviewAgent("cursor")).toBe("cursor");
    expect(normalizeReviewAgent("copilot")).toBe("copilot");
  });

  it("drops an unset or unknown agent", () => {
    expect(normalizeReviewAgent(undefined)).toBeUndefined();
    expect(normalizeReviewAgent("")).toBeUndefined();
    expect(normalizeReviewAgent("gemini")).toBeUndefined();
  });
});
