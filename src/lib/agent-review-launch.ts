import { getRepoSetting } from "./api";
import {
  AGENT_REVIEW_TARGET_WORKSPACE_DIFF,
  buildReviewPrompt,
  workspaceDiffSummary,
} from "./agent-review-prompt";

/**
 * Payload of the backend's `auto-review-triggered` event. The backend only
 * emits it when the repository's `auto_review_trigger` matches the jj
 * operation that just ran, so receiving one means a review is due.
 */
export interface AutoReviewEvent {
  repo_path: string;
  workspace_id: number;
  branch_name: string;
  /** `"on-commit"`, `"on-rebase"` or `"on-pull"`. */
  trigger: string;
  /** jj operation the review covers. */
  operation_id: string;
}

/** Agents a terminal session can run. */
export type ReviewAgent = "claude" | "codex" | "cursor" | "copilot";

/** Narrows a stored `review_agent` setting, dropping anything unrecognized. */
export function normalizeReviewAgent(
  value: string | undefined,
): ReviewAgent | undefined {
  return value === "claude" ||
    value === "codex" ||
    value === "cursor" ||
    value === "copilot"
    ? value
    : undefined;
}

/** What a review terminal needs: the prompt to seed it and which agent runs it. */
export interface ReviewLaunch {
  prompt: string;
  agent?: string;
}

export interface WorkspaceReviewRequest {
  repoPath?: string;
  /** Workspace whose diff is reviewed; also the review comments' target id. */
  workspaceId: number;
  branchName?: string;
  /** Changed file count, when the caller already knows it. */
  fileCount?: number;
  /** Replaces the generated summary line, e.g. to name the jj operation. */
  diffSummary?: string;
}

/**
 * Resolves the repository's review settings and renders the review prompt.
 *
 * The manual Start Review button and the automatic triggers both go through
 * this, so a repo's custom prompt and review agent apply the same way however
 * the review started.
 */
export async function prepareWorkspaceReview({
  repoPath,
  workspaceId,
  branchName,
  fileCount = 0,
  diffSummary,
}: WorkspaceReviewRequest): Promise<ReviewLaunch> {
  let customPrompt: string | null = null;
  let reviewAgent: string | null = null;
  if (repoPath) {
    try {
      [customPrompt, reviewAgent] = await Promise.all([
        getRepoSetting(repoPath, "review_prompt"),
        getRepoSetting(repoPath, "review_agent"),
      ]);
    } catch {
      // Repo may not be initialized yet — fall back to the built-in prompt.
    }
  }
  const prompt = buildReviewPrompt(customPrompt, {
    targetType: AGENT_REVIEW_TARGET_WORKSPACE_DIFF,
    targetId: String(workspaceId),
    diffSummary: diffSummary ?? workspaceDiffSummary(branchName, fileCount),
  });
  return { prompt, agent: reviewAgent || undefined };
}

/** Summary line naming the operation that started an automatic review. */
export function autoReviewSummary(
  trigger: string,
  branchName: string | undefined,
): string {
  const what =
    trigger === "on-commit"
      ? "the commit just created"
      : trigger === "on-rebase"
        ? "the rebase just applied"
        : "the changes just pulled from the remote";
  return branchName
    ? `${what} on the ${branchName} workspace diff`
    : `${what} on the current workspace diff`;
}
