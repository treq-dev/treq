import { useState } from "react";
import useSWR from "swr";
import { useMutation } from "../../hooks/useMutation";
import { invalidateQueries } from "../../lib/swr-cache";
import { Loader2, MessageSquare, Sparkles, X } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import {
  ghCloseIssue,
  ghCreateIssue,
  ghCreateIssueComment,
  ghReopenIssue,
  ghViewIssue,
} from "../../lib/api";
import type { GitHubIssueAttachment } from "../../lib/promptAttachments";
import { MarkdownContent } from "../MarkdownContent";
import {
  formatDate,
  LabelChip,
  OpenInWebButton,
  StateChip,
  useGhErrorToast,
} from "./shared";

export function IssueDetailPanel({
  repoFullName,
  issueNumber,
  onClose,
  onStartPrompt,
}: {
  repoFullName: string;
  issueNumber: number;
  onClose: () => void;
  onStartPrompt?: (issue: GitHubIssueAttachment) => void;
}) {
  const ghErrorToast = useGhErrorToast();
  const [commentBody, setCommentBody] = useState("");

  const { data: issue, isLoading } = useSWR(
    ["gh-issue", repoFullName, issueNumber],
    () => ghViewIssue(repoFullName, issueNumber),
  );

  const addComment = useMutation({
    mutationFn: () =>
      ghCreateIssueComment(repoFullName, issueNumber, commentBody),
    onSuccess: () => {
      setCommentBody("");
      void invalidateQueries(["gh-issue", repoFullName, issueNumber]);
    },
    onError: ghErrorToast("Failed to post comment"),
  });

  const closeIssue = useMutation({
    mutationFn: () => ghCloseIssue(repoFullName, issueNumber),
    onSuccess: () => {
      void invalidateQueries(["gh-issue", repoFullName, issueNumber]);
      void invalidateQueries(["gh-issues", repoFullName]);
    },
    onError: ghErrorToast("Failed to close issue"),
  });

  const reopenIssue = useMutation({
    mutationFn: () => ghReopenIssue(repoFullName, issueNumber),
    onSuccess: () => {
      void invalidateQueries(["gh-issue", repoFullName, issueNumber]);
      void invalidateQueries(["gh-issues", repoFullName]);
    },
    onError: ghErrorToast("Failed to reopen issue"),
  });

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <span className="text-base font-semibold text-muted-foreground">
          Issue #{issueNumber}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onClose}
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {isLoading && (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {issue && (
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          <div>
            <div className="flex items-start gap-3">
              <h2 className="text-2xl font-semibold flex-1 min-w-0">
                {issue.title}
              </h2>
              <div className="flex items-center gap-2 shrink-0">
                {onStartPrompt && (
                  <Button
                    size="sm"
                    className="text-base gap-1.5"
                    onClick={() =>
                      onStartPrompt({
                        number: issue.number,
                        url: issue.url,
                        title: issue.title,
                      })
                    }
                  >
                    <Sparkles className="w-4 h-4" />
                    Agent...
                  </Button>
                )}
                <OpenInWebButton url={issue.url} />
              </div>
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <StateChip state={issue.state} />
              <span className="text-base text-muted-foreground">
                #{issue.number} opened by {issue.author.login} on{" "}
                {formatDate(issue.created_at)}
              </span>
            </div>
            {issue.labels.length > 0 && (
              <div className="flex gap-1 flex-wrap mt-2">
                {issue.labels.map((l) => (
                  <LabelChip key={l.name} name={l.name} color={l.color} />
                ))}
              </div>
            )}
          </div>

          {issue.body && (
            <div className="bg-muted/30 rounded-md p-3">
              <MarkdownContent
                content={issue.body}
                className="text-base prose-base prose-code:text-base"
              />
            </div>
          )}

          {(issue.comments ?? []).length > 0 && (
            <div className="space-y-3">
              <h3 className="text-base font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                <MessageSquare className="w-3 h-3" />
                Comments ({issue.comments!.length})
              </h3>
              {issue.comments!.map((c) => (
                <div
                  key={c.id}
                  className="bg-muted/30 rounded-md p-3 text-base"
                >
                  <div className="flex items-center gap-1 text-base text-muted-foreground mb-1">
                    <span className="font-medium">{c.author.login}</span>
                    <span>·</span>
                    <span>{formatDate(c.created_at)}</span>
                  </div>
                  <MarkdownContent
                    content={c.body}
                    className="text-base prose-base prose-code:text-base"
                  />
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <h3 className="text-base font-semibold uppercase tracking-widest text-muted-foreground">
              Add Comment
            </h3>
            <Textarea
              placeholder="Leave a comment..."
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  if (commentBody.trim() && !addComment.isPending) {
                    addComment.mutate();
                  }
                }
              }}
              rows={3}
              className="text-base"
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="text-base"
                disabled={!commentBody.trim() || addComment.isPending}
                onClick={() => addComment.mutate()}
              >
                {addComment.isPending ? (
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                ) : null}
                Comment
              </Button>
              {issue.state === "OPEN" ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-base"
                  disabled={closeIssue.isPending}
                  onClick={() => closeIssue.mutate()}
                >
                  {closeIssue.isPending ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : null}
                  Close Issue
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-base"
                  disabled={reopenIssue.isPending}
                  onClick={() => reopenIssue.mutate()}
                >
                  {reopenIssue.isPending ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : null}
                  Reopen Issue
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function CreateIssueForm({
  repoFullName,
  onSuccess,
  onCancel,
}: {
  repoFullName: string;
  onSuccess: (issueNumber: number) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const create = useMutation({
    mutationFn: () => ghCreateIssue(repoFullName, title, body),
    onSuccess: (issueNumber) => {
      void invalidateQueries(["gh-issues", repoFullName]);
      onSuccess(issueNumber);
    },
  });

  return (
    <div className="p-4 space-y-3 border-b border-border">
      <h3 className="text-base font-semibold">New Issue</h3>
      <Input
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="text-base"
      />
      <Textarea
        placeholder="Description (optional)"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        className="text-base"
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          className="text-base"
          disabled={!title.trim() || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? (
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
          ) : null}
          Submit Issue
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-base"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
      {create.isError && (
        <p className="text-base text-destructive">{String(create.error)}</p>
      )}
    </div>
  );
}
