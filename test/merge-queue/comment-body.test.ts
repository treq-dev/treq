import { describe, expect, it } from "vitest";
import { formatCommentBody } from "../../supabase/functions/_shared/merge-queue/github-adapter.ts";

describe("formatCommentBody", () => {
  it("links the comment to treq.dev with UTM parameters", () => {
    const body = formatCommentBody(
      "🚦 **Treq Merge Queue**: Testing in lane 1.",
    );
    expect(body).toContain(
      "https://treq.dev/?utm_source=github&utm_medium=merge_queue_comment&utm_campaign=merge_queue",
    );
    expect(body.startsWith("🚦 **Treq Merge Queue**: Testing in lane 1.")).toBe(
      true,
    );
  });

  it("keeps the retry marker as the last line so redeliveries stay detectable", () => {
    const body = formatCommentBody("text", "enqueue:q-1:42:abc");
    expect(body.endsWith("<!-- treq:enqueue:q-1:42:abc -->")).toBe(true);
    expect(body).toContain("treq.dev");
  });
});
