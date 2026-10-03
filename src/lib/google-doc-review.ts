import { GOOGLE_DOC_REVIEW_TARGET, type PreparedDocReview } from "./api-google";

/**
 * Prompt for reviewing an exported Google Drive file. The agent records
 * findings with `treq agent-review add`, anchored to lines of the export;
 * treq later posts them to the Drive file as comments quoting those lines.
 */
export function buildDocReviewPrompt(
  review: PreparedDocReview,
  customInstructions?: string | null,
): string {
  const target = `--target-type ${GOOGLE_DOC_REVIEW_TARGET} --target-id ${review.file.id}`;
  const extra = customInstructions?.trim()
    ? `\nReviewer instructions from the user:\n${customInstructions.trim()}\n`
    : "";
  return `You are reviewing a Google Drive document, not code.

Document: "${review.file.name}"
Exported copy: ${review.root}/${review.file_name} (${review.line_count} lines)
${extra}
Work through these steps in order.

1. List the comments this document already has from earlier runs, so you do not repeat one:

     treq agent-review list ${target}

2. Read the exported copy. Look for factual errors, unclear or ambiguous
   statements, contradictions, missing information a reader would need,
   and structural problems. Skip pure formatting issues caused by the export.

3. Record every new finding as a review comment:

  treq agent-review add \\
    ${target} \\
    --file ${review.file_name} \\
    --start-line <first line> --end-line <last line> \\
    --side new \\
    --comment "<what is wrong and why it matters>"

Add --suggestion "<replacement text>" when you can name the exact rewrite.

Rules:
- Anchor each comment to the narrowest line range; those lines are quoted
  back to the document's authors.
- Do not edit the exported copy or any other file.
- Say nothing if the document is fine; do not invent findings.

When you are done, print a one-paragraph summary and how many comments you left.`;
}
