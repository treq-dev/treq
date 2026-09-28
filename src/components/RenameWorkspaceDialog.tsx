import { useActionState, useEffect, useState } from "react";
import useSWR from "swr";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { FormPendingButton } from "./ui/form-pending-button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { useToast } from "./ui/toast";
import { type Workspace, renameWorkspace } from "../lib/api";
import { invalidateQueries } from "../lib/swr-cache";
import { useDebounce } from "../hooks/useDebounce";

interface RenameWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoPath: string;
  workspace: Workspace;
  onSuccess: () => void;
}

export const RenameWorkspaceDialog: React.FC<RenameWorkspaceDialogProps> = ({
  open,
  onOpenChange,
  repoPath,
  workspace,
  onSuccess,
}) => {
  const [branchName, setBranchName] = useState(workspace.branch_name);
  const { addToast } = useToast();
  const trimmedName = branchName.trim();
  const debouncedName = useDebounce(branchName, 500).trim();

  useEffect(() => {
    if (open) {
      setBranchName(workspace.branch_name);
    }
  }, [open, workspace.branch_name]);

  const { data: checkedResult, isLoading: isCheckRunning } = useSWR(
    open && debouncedName && debouncedName !== workspace.branch_name
      ? ["rename-workspace-dry-run", repoPath, workspace.id, debouncedName]
      : null,
    async () => {
      try {
        const result = await renameWorkspace(
          repoPath,
          workspace.id,
          debouncedName,
          true,
        );
        return {
          name: debouncedName,
          success: result.success,
          message: result.message,
        };
      } catch (err) {
        return {
          name: debouncedName,
          success: false,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // A result for an earlier name says nothing about the name now typed.
  const validationResult =
    checkedResult?.name === trimmedName ? checkedResult : undefined;
  const isChecking =
    isCheckRunning ||
    (trimmedName !== "" &&
      trimmedName !== workspace.branch_name &&
      !validationResult);

  const [error, renameAction, isPending] = useActionState(
    async (_prev: string, formData: FormData) => {
      const nextName = String(formData.get("branchName") ?? "").trim();
      if (!nextName || nextName === workspace.branch_name) return "";

      try {
        const result = await renameWorkspace(
          repoPath,
          workspace.id,
          nextName,
          false,
        );

        if (!result.success) {
          return result.message;
        }

        addToast({
          title: "Workspace renamed",
          description: `Renamed to ${nextName}`,
          type: "success",
        });

        void invalidateQueries(["workspaces"]);
        void invalidateQueries(["workspace-statuses"]);
        onSuccess();
        onOpenChange(false);
        return "";
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        addToast({
          title: "Failed to rename workspace",
          description: errorMsg,
          type: "error",
        });
        return errorMsg;
      }
    },
    "",
  );

  const canSubmit =
    trimmedName !== "" &&
    trimmedName !== workspace.branch_name &&
    !isChecking &&
    validationResult?.success === true &&
    !isPending;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      // requestSubmit() ignores the disabled Rename button, so gate it here.
      if (canSubmit) e.currentTarget.closest("form")?.requestSubmit();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>Rename Workspace</DialogTitle>
          <DialogDescription>
            Rename the branch for this workspace
          </DialogDescription>
        </DialogHeader>

        <form action={renameAction} className="contents">
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="branch-name">Branch Name</Label>
              <div className="relative">
                <Input
                  id="branch-name"
                  name="branchName"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  placeholder="e.g., feat/new-name"
                  className={isChecking || validationResult ? "pr-10" : ""}
                  autoFocus
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {isChecking && (
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  )}
                  {!isChecking && validationResult?.success && (
                    <Check className="w-4 h-4 text-green-500" />
                  )}
                  {!isChecking &&
                    validationResult &&
                    !validationResult.success && (
                      <AlertCircle className="w-4 h-4 text-destructive" />
                    )}
                </div>
              </div>
              {!isChecking && validationResult && !validationResult.success && (
                <p className="text-sm text-destructive flex items-center gap-2">
                  <AlertCircle className="w-3 h-3 shrink-0" />
                  {validationResult.message}
                </p>
              )}
            </div>

            {error && <div className="text-sm text-destructive">{error}</div>}
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <FormPendingButton pendingLabel="Renaming..." disabled={!canSubmit}>
              Rename
            </FormPendingButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
