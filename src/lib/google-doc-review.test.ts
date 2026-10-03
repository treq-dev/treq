import { describe, expect, it } from "vitest";
import { buildDocReviewPrompt } from "./google-doc-review";

const review = {
  file: {
    id: "doc_1",
    name: "Q3 plan",
    mime_type: "application/vnd.google-apps.document",
    modified_time: null,
    web_view_link: null,
    owner: null,
    reviewable: true,
  },
  root: "/home/me/Documents/treq/exports/doc_1",
  file_name: "Q3-plan.md",
  line_count: 12,
};

describe("buildDocReviewPrompt", () => {
  it("targets the exported document", () => {
    const prompt = buildDocReviewPrompt(review);
    expect(prompt).toContain("--target-type google_doc --target-id doc_1");
    expect(prompt).toContain("--file Q3-plan.md");
    expect(prompt).toContain(
      "/home/me/Documents/treq/exports/doc_1/Q3-plan.md",
    );
    expect(prompt).not.toContain("Reviewer instructions");
  });

  it("includes custom instructions", () => {
    expect(buildDocReviewPrompt(review, " Focus on numbers ")).toContain(
      "Reviewer instructions from the user:\nFocus on numbers",
    );
  });
});
