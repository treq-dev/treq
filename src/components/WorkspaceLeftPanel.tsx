import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import {
  TargetBranchSelector,
  type BranchListItem,
} from "./TargetBranchSelector";
import {
  getValidTargets,
  type NewWorkspaceChainEntry,
} from "../lib/workspace-tree";
import { type Workspace } from "../lib/api";
import { cn } from "../lib/utils";
import { appendPathSuggestion } from "../lib/workspaceMetadata";
import { Button } from "./ui/button";
import {
  type BranchStatus,
  NewWorkspaceStackCard,
} from "./NewWorkspaceStackCard";

export interface WorkspaceLeftPanelProps {
  sourceWorkspace: Workspace | null;
  hasSourceWorkspace: boolean;
  isStackOnRoot: boolean;
  availableBranches: BranchListItem[];
  branchesLoading: boolean;
  targetBranch: string | null;
  onSelectTargetBranch: (branch: string) => void;
  position: "before" | "after";
  onSetPosition: (pos: "before" | "after") => void;
  stackChain: NewWorkspaceChainEntry[];
  /** Branch the chain lands on; null until it is known. */
  baseBranch: string | null;
  moveToExisting: boolean;
  onSetMoveToExisting: (val: boolean) => void;
  otherWorkspaces: Workspace[];
  targetWorkspaceId: number | null;
  onSetTargetWorkspaceId: (id: number) => void;
  description: string;
  onSetDescription: (val: string) => void;
  title: string;
  onSetTitle: (val: string) => void;
  sparsePaths: string;
  onSetSparsePaths: (val: string) => void;
  symlinkedDirs: string;
  onSetSymlinkedDirs: (val: string) => void;
  gitignoreSuggestions: string[];
  branchName: string;
  onSetBranchName: (val: string) => void;
  onSetIsEditingBranch: (val: boolean) => void;
  branchPattern: string;
  branchStatus: BranchStatus;
  loading: boolean;
  allWorkspaces: Workspace[];
}

export const WorkspaceLeftPanel: React.FC<WorkspaceLeftPanelProps> = ({
  sourceWorkspace,
  hasSourceWorkspace,
  isStackOnRoot,
  availableBranches,
  branchesLoading,
  targetBranch,
  onSelectTargetBranch,
  position,
  onSetPosition,
  stackChain,
  baseBranch,
  moveToExisting,
  onSetMoveToExisting,
  otherWorkspaces,
  targetWorkspaceId,
  onSetTargetWorkspaceId,
  description,
  onSetDescription,
  title,
  onSetTitle,
  sparsePaths,
  onSetSparsePaths,
  symlinkedDirs,
  onSetSymlinkedDirs,
  gitignoreSuggestions,
  branchName,
  onSetBranchName,
  onSetIsEditingBranch,
  branchPattern,
  branchStatus,
  loading,
  allWorkspaces,
}) => {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3 w-full">
      {/* Stacking On - always show */}
      <div className="grid gap-1.5">
        <Label className="text-xs">Stacking On</Label>
        {sourceWorkspace ? (
          <Input
            value={
              position === "before" && sourceWorkspace.target_branch
                ? sourceWorkspace.target_branch
                : sourceWorkspace.branch_name
            }
            disabled
            className="text-xs text-muted-foreground h-8"
          />
        ) : (
          <TargetBranchSelector
            branches={
              !branchName
                ? availableBranches
                : availableBranches.filter((b) =>
                    getValidTargets(allWorkspaces, branchName).includes(b.name),
                  )
            }
            loading={branchesLoading}
            targetBranch={targetBranch}
            onSelect={onSelectTargetBranch}
            disabled={loading}
          />
        )}
      </div>

      {/* Position toggle: only stacking on a workspace honours "before". */}
      {sourceWorkspace && !isStackOnRoot && !moveToExisting && (
        <div className="flex items-center gap-2">
          <Label className="text-xs whitespace-nowrap">Position:</Label>
          <div className="flex gap-1 bg-muted p-0.5 rounded-md">
            {(["before", "after"] as const).map((pos) => (
              <button
                key={pos}
                type="button"
                onClick={() => onSetPosition(pos)}
                className={cn(
                  "px-2.5 py-1 text-xs font-medium rounded transition-colors capitalize",
                  position === pos
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {pos}
              </button>
            ))}
          </div>
        </div>
      )}

      {!moveToExisting && baseBranch && (
        <NewWorkspaceStackCard
          chain={stackChain}
          baseBranch={baseBranch}
          branchName={branchName}
          onBranchNameChange={(value) => {
            onSetBranchName(value);
            onSetIsEditingBranch(true);
          }}
          branchPlaceholder={branchPattern.replace("{name}", "example")}
          branchStatus={branchStatus}
        />
      )}

      {/* Move to existing workspace toggle */}
      {hasSourceWorkspace && sourceWorkspace && (
        <div className="border-t border-border/50 pt-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={moveToExisting}
              onChange={(e) => onSetMoveToExisting(e.target.checked)}
              className="rounded"
            />
            <span className="text-xs text-muted-foreground">
              Move to existing workspace instead
            </span>
          </label>
        </div>
      )}

      {/* Existing workspace dropdown (when moveToExisting is on) */}
      {moveToExisting && (
        <div className="grid gap-1.5">
          <Label className="text-xs">Target Workspace</Label>
          {otherWorkspaces.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No other workspaces available.
            </p>
          ) : (
            <select
              className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={targetWorkspaceId ?? ""}
              onChange={(e) => onSetTargetWorkspaceId(Number(e.target.value))}
            >
              {otherWorkspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.branch_name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {!moveToExisting && (
        <div className="grid gap-1.5">
          <Label htmlFor="title" className="text-xs">
            Title (optional)
          </Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => onSetTitle(e.target.value)}
            placeholder="e.g., Settings Dark Mode"
            className="text-sm h-8"
          />
        </div>
      )}

      {/* Description (hidden when moveToExisting) */}
      {!moveToExisting && (
        <div className="grid gap-1.5">
          <Label htmlFor="description" className="text-xs">
            Description (optional)
          </Label>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => onSetDescription(e.target.value)}
            placeholder="e.g., Add dark mode to settings"
            rows={2}
            autoResize
            className="text-sm min-h-[58px]"
            autoFocus={!hasSourceWorkspace}
            tabIndex={1}
          />
        </div>
      )}

      {/* Advanced options: sparse checkout + symlink dirs (plain creation only) */}
      {!moveToExisting && !sourceWorkspace && (
        <div className="grid gap-1.5">
          <button
            type="button"
            onClick={() => setAdvancedOpen(!advancedOpen)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit"
          >
            {advancedOpen ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            <span>Advanced</span>
          </button>
          {advancedOpen && (
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="sparse-paths" className="text-xs">
                  Sparse paths (optional, one per line)
                </Label>
                <Textarea
                  id="sparse-paths"
                  value={sparsePaths}
                  onChange={(e) => onSetSparsePaths(e.target.value)}
                  placeholder={"e.g., src/api\ndocs"}
                  rows={2}
                  autoResize
                  className="text-sm min-h-[58px]"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="symlinked-dirs" className="text-xs">
                  Symlink from home repo (optional, one per line)
                </Label>
                <Textarea
                  id="symlinked-dirs"
                  value={symlinkedDirs}
                  onChange={(e) => onSetSymlinkedDirs(e.target.value)}
                  placeholder={"e.g., node_modules\ntarget"}
                  rows={2}
                  autoResize
                  className="text-sm min-h-[58px]"
                />
                <p className="text-xs text-muted-foreground">
                  Heavy dirs are linked instead of copied so each workspace
                  shares the home tree.
                </p>
                {gitignoreSuggestions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {gitignoreSuggestions.map((suggestion) => (
                      <Button
                        key={suggestion}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={() =>
                          onSetSymlinkedDirs(
                            appendPathSuggestion(symlinkedDirs, suggestion),
                          )
                        }
                      >
                        + {suggestion}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
