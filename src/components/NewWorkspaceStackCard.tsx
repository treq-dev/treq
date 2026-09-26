import { AlertCircle, Check, Cloud, Loader2 } from "lucide-react";
import type { NewWorkspaceChainEntry } from "../lib/workspace-tree";
import { cn } from "../lib/utils";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { StackDot, StackTrack } from "./StackTrack";

export type BranchStatus = "new" | "local" | "remote" | "checking" | null;

interface NewWorkspaceStackCardProps {
  chain: NewWorkspaceChainEntry[];
  baseBranch: string;
  branchName: string;
  onBranchNameChange: (value: string) => void;
  branchPlaceholder: string;
  branchStatus: BranchStatus;
}

/**
 * Stack card for the create dialog: the chain the new workspace will join,
 * from the tip down to the base branch. The new workspace's row holds the
 * branch name input.
 */
export function NewWorkspaceStackCard({
  chain,
  baseBranch,
  branchName,
  onBranchNameChange,
  branchPlaceholder,
  branchStatus,
}: NewWorkspaceStackCardProps) {
  return (
    <div
      data-testid="new-workspace-stack-card"
      className="border rounded-lg px-4 py-2"
    >
      <StackTrack baseBranch={baseBranch}>
        {chain.map((entry) =>
          entry.kind === "new" ? (
            <li key="new" data-testid="new-workspace-stack-item">
              <div className="relative z-10 flex w-full items-start gap-3 py-2 px-2 -mx-2 rounded-md bg-primary/10 border border-primary/40 shadow-sm">
                <div className="mt-1.5">
                  <StackDot highlighted />
                </div>
                <div className="flex-1 min-w-0 grid gap-1">
                  <Label htmlFor="branch" className="sr-only">
                    Branch Name
                  </Label>
                  <div className="relative">
                    <Input
                      id="branch"
                      value={branchName}
                      onChange={(e) => onBranchNameChange(e.target.value)}
                      placeholder={branchPlaceholder}
                      className="pr-8 h-8 text-sm font-mono bg-background"
                      tabIndex={2}
                    />
                    <BranchStatusIcon status={branchStatus} />
                  </div>
                  {branchStatus === "local" && (
                    <p className="text-xs text-yellow-500">
                      Branch already exists locally
                    </p>
                  )}
                  {branchStatus === "remote" && (
                    <p className="text-xs text-blue-500">
                      Branch exists on remote — will check out
                    </p>
                  )}
                </div>
              </div>
            </li>
          ) : (
            <li key={entry.branch}>
              <div className="relative z-10 flex w-full items-start gap-3 py-2 px-2 -mx-2">
                <StackDot highlighted={false} />
                <div className="flex-1 min-w-0">
                  <p
                    className={cn(
                      "text-sm font-mono truncate",
                      !entry.workspace && "text-muted-foreground",
                    )}
                    title={entry.branch}
                  >
                    {entry.branch}
                  </p>
                </div>
              </div>
            </li>
          ),
        )}
      </StackTrack>
    </div>
  );
}

function BranchStatusIcon({ status }: { status: BranchStatus }) {
  if (!status) return null;
  return (
    <div className="absolute right-2 top-1/2 -translate-y-1/2">
      {status === "checking" && (
        <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
      )}
      {status === "new" && <Check className="w-3.5 h-3.5 text-green-500" />}
      {status === "local" && (
        <AlertCircle className="w-3.5 h-3.5 text-yellow-500" />
      )}
      {status === "remote" && <Cloud className="w-3.5 h-3.5 text-blue-500" />}
    </div>
  );
}
