import { createContext, useContext } from "react";
import type { AgentReviewComment } from "../../lib/api-types-review";
import { AgentReviewCommentCard } from "./AgentReviewCommentCard";
import type { CommentLineQuery } from "./types";

export interface AgentReviewContextValue {
  getAgentCommentsForLine: (query: CommentLineQuery) => AgentReviewComment[];
  resolveAgentComment: (commentId: string) => Promise<void>;
  deleteAgentComment: (commentId: string) => Promise<void>;
  applyAgentSuggestion: (commentId: string) => Promise<void>;
  onAgentCommentError: (message: string) => void;
}

/**
 * Local-only agent review comments reach the diff rows through context rather
 * than the `DiffContentArea` prop bundle: they are read at one leaf (the diff
 * line) and nothing between the viewer and that leaf needs them.
 */
export const AgentReviewContext = createContext<AgentReviewContextValue | null>(
  null,
);

export function useAgentReview(): AgentReviewContextValue | null {
  return useContext(AgentReviewContext);
}

interface AgentReviewInlineListProps {
  filePath: string;
  lineNumber: number;
  lineSide: "old" | "new";
}

/** Inline block of agent review comments anchored to one diff line. */
export function AgentReviewInlineList({
  filePath,
  lineNumber,
  lineSide,
}: AgentReviewInlineListProps) {
  const agentReview = useAgentReview();
  if (!agentReview) return null;

  const comments = agentReview.getAgentCommentsForLine({
    filePath,
    hunkId: "",
    lineNumber,
    side: lineSide,
  });
  if (comments.length === 0) return null;

  return (
    <div
      data-testid="agent-review-inline-list"
      className="border-y border-violet-500/30 bg-violet-500/[0.03] px-[16px] py-[8px] space-y-2"
    >
      {comments.map((comment) => (
        <AgentReviewCommentCard
          key={comment.id}
          comment={comment}
          onResolve={agentReview.resolveAgentComment}
          onDelete={agentReview.deleteAgentComment}
          onApplySuggestion={agentReview.applyAgentSuggestion}
          onError={agentReview.onAgentCommentError}
        />
      ))}
    </div>
  );
}
