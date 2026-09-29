import { describe, expect, it } from "vitest";
import { autoReviewSummary } from "./agent-review-launch";

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
