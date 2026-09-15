import { useState } from "react";
import { Bot, Check, Trash2, Wand2 } from "lucide-react";
import { Button } from "../ui/button";
import type { AgentReviewComment } from "../../lib/api-types-review";

interface AgentReviewCommentCardProps {
  comment: AgentReviewComment;
  onResolve: (commentId: string) => Promise<void>;
  onDelete: (commentId: string) => Promise<void>;
  onApplySuggestion: (commentId: string) => Promise<void>;
  onError: (message: string) => void;
}

/**
 * One local-only review comment from the review agent. Styled apart from both
 * the user's own draft `LineComment` cards and the read-only GitHub review
 * threads, and badged so it is never read as something that exists on GitHub.
 */
export function AgentReviewCommentCard({
  comment,
  onResolve,
  onDelete,
  onApplySuggestion,
  onError,
}: AgentReviewCommentCardProps) {
  const [pending, setPending] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setPending(true);
    try {
      await action();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      data-testid="agent-review-comment-card"
      className="rounded-md border border-violet-500/40 bg-violet-500/5 p-[12px] space-y-2"
    >
      <div className="flex items-center gap-2">
        <Bot className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
        <span className="text-xs font-medium text-violet-600 dark:text-violet-400">
          Local review (not on GitHub)
        </span>
        <span className="text-xs text-muted-foreground">
          {comment.file_path}:{comment.start_line}
          {comment.end_line !== comment.start_line && `-${comment.end_line}`}
        </span>
      </div>

      <p className="text-sm whitespace-pre-wrap">{comment.comment_text}</p>

      {comment.suggested_replacement != null && (
        <div className="rounded border border-border/60 overflow-hidden">
          <div className="px-[8px] py-[4px] text-xs text-muted-foreground bg-muted/60 border-b border-border/60">
            Suggested change
          </div>
          <pre
            data-testid="agent-review-suggestion"
            className="px-[8px] py-[6px] text-xs font-mono whitespace-pre-wrap break-all bg-green-500/10"
          >
            {comment.suggested_replacement}
          </pre>
        </div>
      )}

      <div className="flex items-center gap-2">
        {comment.suggested_replacement != null && (
          <Button
            size="sm"
            variant="default"
            className="gap-1.5"
            disabled={pending}
            onClick={() => run(() => onApplySuggestion(comment.id))}
          >
            <Wand2 className="w-3 h-3" />
            Apply
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={pending}
          onClick={() => run(() => onResolve(comment.id))}
        >
          <Check className="w-3 h-3" />
          Resolve
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="gap-1.5 text-muted-foreground"
          disabled={pending}
          onClick={() => run(() => onDelete(comment.id))}
        >
          <Trash2 className="w-3 h-3" />
          Delete
        </Button>
      </div>
    </div>
  );
}
