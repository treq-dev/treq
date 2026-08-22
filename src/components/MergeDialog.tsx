import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { FormPendingButton } from "./ui/form-pending-button";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import type { Workspace } from "../lib/api";
import { AlertTriangle, ArrowRight } from "lucide-react";

// Define MergeStrategy locally since git API was removed
export type MergeStrategy = "regular" | "squash" | "no_ff" | "ff_only";

interface MergeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace: Workspace | null;
  mainBranch: string | null;
  aheadCount: number;
  hasWorkspaceChanges: boolean;
  changedFiles: string[];
  isLoadingDetails: boolean;
  onConfirm: (options: {
    strategy: MergeStrategy;
    commitMessage: string;
    discardChanges: boolean;
  }) => void | Promise<void>;
}

const STRATEGY_OPTIONS: Array<{
  value: MergeStrategy;
  label: string;
  description: string;
}> = [
  {
    value: "regular",
    label: "Regular",
    description: "Allow fast-forward when possible",
  },
  {
    value: "squash",
    label: "Squash",
    description: "Combine commits into a single commit",
  },
  {
    value: "no_ff",
    label: "No Fast-Forward",
    description: "Always create a merge commit",
  },
  {
    value: "ff_only",
    label: "Fast-Forward Only",
    description: "Abort unless fast-forward is possible",
  },
];

export const MergeDialog: React.FC<MergeDialogProps> = ({
  open,
  onOpenChange,
  workspace,
  mainBranch,
  aheadCount,
  hasWorkspaceChanges,
  changedFiles,
  isLoadingDetails,
  onConfirm,
}) => {
  const [strategy, setStrategy] = useState<MergeStrategy>("regular");
  const [commitMessage, setCommitMessage] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  useEffect(() => {
    if (open && workspace) {
      setStrategy("regular");
      setCommitMessage(
        `Merge ${workspace.branch_name} into ${mainBranch || "main"}`,
      );
      setConfirmDiscard(false);
    }
  }, [open, workspace, mainBranch]);

  useEffect(() => {
    if (!hasWorkspaceChanges) {
      setConfirmDiscard(false);
    }
  }, [hasWorkspaceChanges]);

  const canConfirm = (() => {
    if (!workspace || isLoadingDetails) return false;
    if (hasWorkspaceChanges && !confirmDiscard) return false;
    if (strategy === "squash" && !commitMessage.trim()) return false;
    return true;
  })();

  const mergeAction = async () => {
    if (!workspace) return;
    await onConfirm({
      strategy,
      commitMessage,
      discardChanges: hasWorkspaceChanges,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Merge Workspace</DialogTitle>
          <DialogDescription>
            Merge changes from this workspace into the main repository branch.
          </DialogDescription>
        </DialogHeader>

        {!workspace ? (
          <div className="text-sm text-muted-foreground">
            Select a workspace to merge.
          </div>
        ) : isLoadingDetails ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Preparing merge details...
          </div>
        ) : (
          <div className="space-y-6">
            <div className="bg-muted/50 rounded-lg p-3">
              <div className="text-sm font-medium mb-1">Merge Direction</div>
              <div className="flex items-center gap-2 text-sm">
                <span className="font-mono text-sm sm:text-sm">
                  {workspace.branch_name}
                </span>
                <ArrowRight className="w-4 h-4" />
                <span className="font-mono text-sm sm:text-sm">
                  {mainBranch || "Current"}
                </span>
              </div>
              <div className="text-sm text-muted-foreground mt-2">
                {aheadCount > 0
                  ? `${aheadCount} commits ahead of ${mainBranch || "main"}`
                  : "No new commits to merge"}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="strategy">Merge Strategy</Label>
              <div className="border rounded-md">
                <select
                  id="strategy"
                  value={strategy}
                  onChange={(event) =>
                    setStrategy(event.target.value as MergeStrategy)
                  }
                  className="w-full bg-transparent px-3 py-2 text-sm focus:outline-none"
                >
                  {STRATEGY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <div className="px-3 py-2 text-sm text-muted-foreground border-t">
                  {
                    STRATEGY_OPTIONS.find((opt) => opt.value === strategy)
                      ?.description
                  }
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="message">Commit Message</Label>
              <Textarea
                id="message"
                value={commitMessage}
                onChange={(event) => setCommitMessage(event.target.value)}
                rows={3}
                placeholder="Enter a commit message"
              />
              {strategy === "ff_only" && (
                <p className="text-sm text-muted-foreground">
                  Optional for fast-forward
                </p>
              )}
            </div>

            {hasWorkspaceChanges && (
              <div className="border border-yellow-500/50 bg-yellow-500/5 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400">
                  <AlertTriangle className="w-4 h-4" />
                  <span className="text-sm font-medium">
                    Workspace has uncommitted changes
                  </span>
                </div>
                <p className="text-sm text-yellow-700 dark:text-yellow-300">
                  These changes must be discarded before merging. Review the
                  files below and confirm you want to proceed.
                </p>
                {changedFiles.length > 0 && (
                  <div className="max-h-32 overflow-auto rounded bg-background/60 border text-sm">
                    <ul className="divide-y">
                      {changedFiles.map((file) => (
                        <li
                          key={file}
                          className="px-3 py-1 font-mono text-[11px]"
                        >
                          {file}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <label className="flex items-start gap-2 text-sm text-yellow-700 dark:text-yellow-300">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={confirmDiscard}
                    onChange={(event) =>
                      setConfirmDiscard(event.target.checked)
                    }
                  />
                  <span>
                    I understand these changes will be permanently discarded.
                  </span>
                </label>
              </div>
            )}
          </div>
        )}

        <form action={mergeAction} className="contents">
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <FormPendingButton pendingLabel="Merging..." disabled={!canConfirm}>
              Confirm Merge
            </FormPendingButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
