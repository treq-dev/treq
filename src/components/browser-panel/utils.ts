import type {
  ElementComment as ApiElementComment,
  PickedElement as ApiPickedElement,
} from "../../lib/api-browser";
import type { ElementComment, PickedElement } from "./types";

export function toLocalElementComment(c: ApiElementComment): ElementComment {
  return {
    id: c.id,
    selector: c.selector,
    tag: c.tag,
    textPreview: c.text_preview,
    htmlSnippet: c.html_snippet,
    x: c.x,
    y: c.y,
    width: c.width,
    height: c.height,
    text: c.text,
    createdAt: c.created_at,
  };
}

export function toApiElementComment(c: ElementComment): ApiElementComment {
  return {
    id: c.id,
    selector: c.selector,
    tag: c.tag,
    text_preview: c.textPreview,
    html_snippet: c.htmlSnippet,
    x: c.x,
    y: c.y,
    width: c.width,
    height: c.height,
    text: c.text,
    created_at: c.createdAt,
  };
}

export function toLocalPickedElement(p: ApiPickedElement): PickedElement {
  return {
    selector: p.selector,
    tag: p.tag,
    textPreview: p.text_preview,
    htmlSnippet: p.html_snippet,
    x: p.x,
    y: p.y,
    width: p.width,
    height: p.height,
  };
}

/** Prompt-facing cap on the element HTML snippet included in the review
 * markdown sent to the agent -- keeps the "additional context" concise even
 * though the captured snippet is already just the element's own opening tag
 * (no children; see the injected script in
 * `src-tauri/src/commands/browser_webview.rs`). */
export const MAX_ELEMENT_HTML_SNIPPET_LENGTH = 200;

export function truncateHtmlSnippet(
  html: string,
  maxLength: number = MAX_ELEMENT_HTML_SNIPPET_LENGTH,
): string {
  if (html.length <= maxLength) return html;
  return `${html.slice(0, maxLength)}…`;
}

/// Only http://localhost*, http://127.0.0.1* and file:// URLs are supported
/// by the in-app browser — mirrors `is_allowed_browser_url` in
/// `src-tauri/src/core/browser_review.rs`, checked client-side too for
/// instant feedback before round-tripping to Rust.
export function isAllowedBrowserUrl(candidate: string): boolean {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (url.protocol === "file:") return true;
  if (url.protocol === "http:") {
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  }
  return false;
}

export function formatPageReviewMarkdown(
  url: string,
  comments: ElementComment[],
  summary: string,
): string {
  let markdown = "## Page Review\n\n";
  markdown += `URL: ${url}\n\n`;

  if (comments.length > 0) {
    markdown += "### Comments\n\n";
    comments.forEach((comment, index) => {
      markdown += `${index + 1}. \`${comment.selector}\` (${comment.tag})\n`;
      if (comment.textPreview) {
        markdown += `   Element text: "${comment.textPreview}"\n`;
      }
      if (comment.htmlSnippet) {
        markdown += `   Element HTML: \`${truncateHtmlSnippet(comment.htmlSnippet)}\`\n`;
      }
      markdown += `> ${comment.text}\n\n`;
    });
  }

  if (summary.trim()) {
    markdown += "### Summary\n";
    markdown += `${summary.trim()}\n`;
  }

  return markdown;
}
