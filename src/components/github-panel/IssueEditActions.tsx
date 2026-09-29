import { Loader2, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { useMutation } from "../../hooks/useMutation";
import { ghDeleteIssue, ghEditIssue } from "../../lib/api";
import type { GhIssue } from "../../lib/api-types";
import { invalidateQueries } from "../../lib/swr-cache";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { useGhErrorToast } from "./shared";

export function EditIssueButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      aria-label="Edit issue"
      title="Edit issue"
      onClick={onClick}
    >
      <Pencil className="w-4 h-4" />
    </Button>
  );
}

/** Inline editor for an issue's title and body. */
export function IssueEditForm({
  repoFullName,
  issue,
  onDone,
}: {
  repoFullName: string;
  issue: GhIssue;
  onDone: () => void;
}) {
  const ghErrorToast = useGhErrorToast();
  const [title, setTitle] = useState(issue.title);
  const [body, setBody] = useState(issue.body ?? "");

  const save = useMutation({
    mutationFn: () => ghEditIssue(repoFullName, issue.number, title, body),
    onSuccess: async () => {
      await invalidateQueries(["gh-issue", repoFullName, issue.number]);
      void invalidateQueries(["gh-issues", repoFullName]);
      onDone();
    },
    onError: ghErrorToast("Failed to update issue"),
  });

  return (
    <div className="space-y-2">
      <Input
        aria-label="Issue title"
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="text-base"
      />
      <Textarea
        aria-label="Issue description"
        placeholder="Description (optional)"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={8}
        className="text-base"
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          className="text-base"
          disabled={!title.trim() || save.isPending}
          aria-busy={save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? (
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
          ) : null}
          Save
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-base"
          disabled={save.isPending}
          onClick={onDone}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * Deletes the issue after the user confirms. GitHub allows this only for
 * repo admins, and it cannot be undone.
 */
export function DeleteIssueButton({
  repoFullName,
  issueNumber,
  onDeleted,
}: {
  repoFullName: string;
  issueNumber: number;
  onDeleted: () => void;
}) {
  const ghErrorToast = useGhErrorToast();
  const [confirming, setConfirming] = useState(false);

  const remove = useMutation({
    mutationFn: () => ghDeleteIssue(repoFullName, issueNumber),
    onSuccess: () => {
      setConfirming(false);
      void invalidateQueries(["gh-issues", repoFullName]);
      onDeleted();
    },
    onError: (error) => {
      setConfirming(false);
      ghErrorToast("Failed to delete issue")(error);
    },
  });

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-destructive"
        aria-label="Delete issue"
        title="Delete issue"
        onClick={() => setConfirming(true)}
      >
        <Trash2 className="w-4 h-4" />
      </Button>
      <AlertDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!remove.isPending) setConfirming(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete issue #{issueNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the issue and its comments on GitHub. You
              cannot undo this.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={remove.isPending}
              aria-busy={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {remove.isPending ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
