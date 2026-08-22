import { describe, expect, it } from "vitest";
import {
  MAX_ELEMENT_HTML_SNIPPET_LENGTH,
  formatPageReviewMarkdown,
  isAllowedBrowserUrl,
  toApiElementComment,
  toLocalElementComment,
  toLocalPickedElement,
  truncateHtmlSnippet,
} from "./utils";
import type { ElementComment } from "./types";

describe("isAllowedBrowserUrl", () => {
  it("allows localhost URLs with any port", () => {
    expect(isAllowedBrowserUrl("http://localhost:3000")).toBe(true);
    expect(isAllowedBrowserUrl("http://localhost:5173/app?x=1")).toBe(true);
  });

  it("allows 127.0.0.1 URLs", () => {
    expect(isAllowedBrowserUrl("http://127.0.0.1:8080/")).toBe(true);
  });

  it("allows file:// URLs", () => {
    expect(isAllowedBrowserUrl("file:///tmp/preview.html")).toBe(true);
  });

  it("rejects general internet URLs", () => {
    expect(isAllowedBrowserUrl("https://example.com")).toBe(false);
    expect(isAllowedBrowserUrl("http://example.com")).toBe(false);
    expect(isAllowedBrowserUrl("http://192.168.1.5:3000")).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(isAllowedBrowserUrl("not a url")).toBe(false);
    expect(isAllowedBrowserUrl("")).toBe(false);
  });
});

describe("truncateHtmlSnippet", () => {
  it("returns the string unchanged when at or under the max length", () => {
    expect(truncateHtmlSnippet("<div></div>", 20)).toBe("<div></div>");
    const exact = "a".repeat(20);
    expect(truncateHtmlSnippet(exact, 20)).toBe(exact);
  });

  it("truncates and appends an ellipsis when over the max length", () => {
    const long = '<div class="x">'.repeat(20);
    const truncated = truncateHtmlSnippet(long, 20);
    expect(truncated.length).toBe(21); // 20 chars + ellipsis
    expect(truncated.startsWith(long.slice(0, 20))).toBe(true);
    expect(truncated.endsWith("…")).toBe(true);
  });

  it("defaults to MAX_ELEMENT_HTML_SNIPPET_LENGTH when no max is given", () => {
    const long = "x".repeat(MAX_ELEMENT_HTML_SNIPPET_LENGTH + 50);
    const truncated = truncateHtmlSnippet(long);
    expect(truncated.length).toBe(MAX_ELEMENT_HTML_SNIPPET_LENGTH + 1);
  });
});

describe("formatPageReviewMarkdown", () => {
  const comment: ElementComment = {
    id: "c1",
    selector: "#checkout > button.primary",
    tag: "BUTTON",
    textPreview: "Place order",
    htmlSnippet: '<button class="primary" id="checkout"></button>',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    text: "This button should be disabled while submitting",
    createdAt: "2026-01-01T00:00:00Z",
  };

  it("includes the URL, each comment's selector, text, HTML snippet, and the summary", () => {
    const markdown = formatPageReviewMarkdown(
      "http://localhost:3000/checkout",
      [comment],
      "Overall looks good, one blocker below",
    );

    expect(markdown).toContain("http://localhost:3000/checkout");
    expect(markdown).toContain("#checkout > button.primary");
    expect(markdown).toContain("BUTTON");
    expect(markdown).toContain(
      "This button should be disabled while submitting",
    );
    expect(markdown).toContain(
      '<button class="primary" id="checkout"></button>',
    );
    expect(markdown).toContain("Overall looks good, one blocker below");
  });

  it("truncates a long HTML snippet in the markdown", () => {
    const longSnippet = `<div class="${"x".repeat(400)}"></div>`;
    const markdown = formatPageReviewMarkdown(
      "http://localhost:3000/",
      [{ ...comment, htmlSnippet: longSnippet }],
      "",
    );
    expect(markdown).not.toContain(longSnippet);
    expect(markdown).toContain(truncateHtmlSnippet(longSnippet));
  });

  it("omits the Comments section when there are no comments", () => {
    const markdown = formatPageReviewMarkdown(
      "http://localhost:3000/",
      [],
      "Looks good overall",
    );
    expect(markdown).not.toContain("### Comments");
    expect(markdown).toContain("Looks good overall");
  });

  it("omits the Summary section when summary is blank", () => {
    const markdown = formatPageReviewMarkdown(
      "http://localhost:3000/",
      [comment],
      "   ",
    );
    expect(markdown).not.toContain("### Summary");
  });
});

describe("comment conversion round trip", () => {
  it("converts local ElementComment to API shape and back", () => {
    const local: ElementComment = {
      id: "c1",
      selector: ".card",
      tag: "DIV",
      textPreview: "50% off",
      htmlSnippet: '<div class="card"></div>',
      x: 1,
      y: 2,
      width: 3,
      height: 4,
      text: "Nice",
      createdAt: "2026-01-01T00:00:00Z",
    };
    const api = toApiElementComment(local);
    expect(api).toEqual({
      id: "c1",
      selector: ".card",
      tag: "DIV",
      text_preview: "50% off",
      html_snippet: '<div class="card"></div>',
      x: 1,
      y: 2,
      width: 3,
      height: 4,
      text: "Nice",
      created_at: "2026-01-01T00:00:00Z",
    });
    expect(toLocalElementComment(api)).toEqual(local);
  });

  it("converts a picked-element event payload to local shape", () => {
    const picked = toLocalPickedElement({
      selector: "#foo",
      tag: "BUTTON",
      text_preview: "Submit",
      html_snippet: '<button id="foo"></button>',
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
    expect(picked).toEqual({
      selector: "#foo",
      tag: "BUTTON",
      textPreview: "Submit",
      htmlSnippet: '<button id="foo"></button>',
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
  });
});
