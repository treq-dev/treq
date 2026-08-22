import type { WorkspaceBookmarkConflict } from "../lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { formatFullTimestamp, formatRelativeTime } from "../lib/utils";
import { GitBranch, Loader2 } from "lucide-react";

interface WorkspaceBookmarkConflictModalProps {
  conflict: WorkspaceBookmarkConflict | null;
  open: boolean;
  onClose: () => void;
  onResolve: () => Promise<void> | void;
  resolving: boolean;
}

export function WorkspaceBookmarkConflictModal({
  conflict,
  open,
  onClose,
  onResolve,
  resolving,
}: WorkspaceBookmarkConflictModalProps) {
  const commits = conflict?.commits ?? [];
  const bookmarkName = conflict?.bookmark ?? "";

  const formattedDescription = (() => {
    if (!bookmarkName) return "";
    return `Bookmark ${bookmarkName} has multiple histories. Treq will rebase the local history onto the remote tip in one atomic operation.`;
  })();

  const handleResolve = () => {
    if (resolving) return;
    onResolve();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (!next ? onClose() : undefined)}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader className="space-y-2">
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-amber-500" />
            Resolve bookmark conflict
          </DialogTitle>
          <DialogDescription>{formattedDescription}</DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
          <p className="font-medium text-foreground">
            {conflict?.workspace_name}
          </p>
          <p className="text-muted-foreground">
            Workspace branch{" "}
            <span className="font-mono">{conflict?.branch_name}</span>
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            All local commits will be preserved and remain reachable:
          </p>
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {commits.map((commit) => (
              <div
                key={commit.commit_id}
                className="w-full rounded-md border border-border bg-background p-3 text-left"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <div className="font-mono text-sm text-foreground">
                    {commit.short_commit_id}
                    <span className="text-muted-foreground">
                      {" "}
                      ({commit.change_id})
                    </span>
                  </div>
                  <span
                    className="text-xs text-muted-foreground"
                    title={formatFullTimestamp(commit.timestamp)}
                  >
                    {formatRelativeTime(commit.timestamp)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-foreground">
                  {commit.description}
                </p>
                <div className="mt-1 text-xs text-muted-foreground">
                  {commit.author_name}
                  {commit.diff_summary ? ` • ${commit.diff_summary}` : null}
                </div>
              </div>
            ))}
            {commits.length === 0 && (
              <div className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                Unable to load conflicting revisions. Try running{" "}
                <code>jj bookmark list</code> manually.
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
          <Button variant="outline" onClick={onClose}>
            Skip for now
          </Button>
          <Button
            onClick={handleResolve}
            disabled={resolving}
            className="min-w-[160px]"
          >
            {resolving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Resolve conflict
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
