import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import {
  type JjDiffHunk,
  type JjFileChange,
  type WorkspaceStatus,
} from "../lib/api";
import { cn } from "../lib/utils";

export interface WorkspaceRightPanelProps {
  dataLoading: boolean;
  activeRightTab: "commits" | "changes";
  onTabChange: (tab: "commits" | "changes") => void;
  workspaceStatus: WorkspaceStatus | null;
  changedFiles: JjFileChange[];
  fileHunksMap: Map<string, { hunks: JjDiffHunk[]; isLoading: boolean }>;
  expandedFiles: Set<string>;
  selectedHunks: Set<string>;
  selectedCommits: Set<string>;
  onToggleCommit: (changeId: string) => void;
  onSelectAllCommits: () => void;
  onClearCommits: () => void;
  onToggleFileExpand: (filePath: string) => void;
  onToggleFileHunks: (filePath: string) => void;
  onToggleHunk: (key: string) => void;
  onSelectAllHunks: () => void;
  onClearHunks: () => void;
  getFileSelectionState: (filePath: string) => "all" | "some" | "none";
  hunkKey: (filePath: string, hunkId: string) => string;
  /** Locked stash commit shown as selected for apply-to-new-workspace. */
  lockedStashCommit?: {
    hash: string;
    message: string;
    timestamp: string;
  } | null;
}

const statusIcon = (status: string) => {
  switch (status) {
    case "modified":
      return "M";
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    default:
      return "?";
  }
};

const statusColor = (status: string) => {
  switch (status) {
    case "modified":
      return "text-yellow-500";
    case "added":
      return "text-green-500";
    case "deleted":
      return "text-red-500";
    case "renamed":
      return "text-blue-500";
    default:
      return "text-muted-foreground";
  }
};

export const WorkspaceRightPanel: React.FC<WorkspaceRightPanelProps> = ({
  dataLoading,
  activeRightTab,
  onTabChange,
  workspaceStatus,
  changedFiles,
  fileHunksMap,
  expandedFiles,
  selectedHunks,
  selectedCommits,
  onToggleCommit,
  onSelectAllCommits,
  onClearCommits,
  onToggleFileExpand,
  onToggleFileHunks,
  onToggleHunk,
  onSelectAllHunks,
  onClearHunks,
  getFileSelectionState,
  hunkKey,
  lockedStashCommit = null,
}) => {
  const commitsAhead = workspaceStatus?.commits_ahead_of_target ?? [];
  const displayCommits = lockedStashCommit
    ? [
        lockedStashCommit,
        ...commitsAhead.filter((c) => c.hash !== lockedStashCommit.hash),
      ]
    : commitsAhead;

  return (
    <div className="flex flex-col min-w-0">
      {dataLoading && !lockedStashCommit ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">Loading...</span>
        </div>
      ) : (
        <Tabs
          value={activeRightTab}
          onValueChange={(v) => onTabChange(v as "commits" | "changes")}
          className="flex flex-col flex-1"
        >
          <TabsList className="text-xs self-start mb-2">
            <TabsTrigger value="commits" className="text-xs">
              Commits ({displayCommits.length})
            </TabsTrigger>
            <TabsTrigger
              value="changes"
              className="text-xs"
              disabled={lockedStashCommit != null}
            >
              Changes ({changedFiles.length})
            </TabsTrigger>
          </TabsList>

          {/* Commits tab */}
          <TabsContent value="commits" className="flex-1 flex flex-col mt-0">
            <div className="flex-1 overflow-y-auto border rounded-md max-h-[280px]">
              {displayCommits.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground text-center">
                  No mutable commits in this workspace
                </div>
              ) : (
                displayCommits.map((commit) => {
                  const isLocked =
                    lockedStashCommit != null &&
                    commit.hash === lockedStashCommit.hash;
                  return (
                    <label
                      key={commit.hash}
                      data-testid={
                        isLocked ? "stash-commit-selected" : undefined
                      }
                      className={cn(
                        "flex items-center gap-2 px-3 py-1.5 border-b last:border-b-0",
                        isLocked
                          ? "bg-accent/40 cursor-default"
                          : "hover:bg-muted/50 cursor-pointer",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={isLocked || selectedCommits.has(commit.hash)}
                        disabled={isLocked}
                        onChange={() => {
                          if (!isLocked) onToggleCommit(commit.hash);
                        }}
                        className="rounded flex-shrink-0"
                      />
                      <span className="text-xs font-mono text-muted-foreground flex-shrink-0">
                        {commit.hash.slice(0, 8)}
                      </span>
                      <span className="text-xs truncate flex-1">
                        {commit.message || "(no description)"}
                        {isLocked ? " (stash)" : ""}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
            {displayCommits.length > 0 && !lockedStashCommit && (
              <div className="flex gap-2 mt-1.5">
                <button
                  type="button"
                  onClick={onSelectAllCommits}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={onClearCommits}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1.5">
              {lockedStashCommit
                ? "Stashed changes will be copied onto the new workspace"
                : "Select commits to move to the new workspace"}
            </p>
          </TabsContent>

          {/* Changes tab */}
          <TabsContent value="changes" className="flex-1 flex flex-col mt-0">
            <div className="flex-1 overflow-y-auto border rounded-md max-h-[280px]">
              {changedFiles.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground text-center">
                  No uncommitted changes
                </div>
              ) : (
                changedFiles.map((file) => {
                  const hunkData = fileHunksMap.get(file.path);
                  const isExpanded = expandedFiles.has(file.path);
                  const fileState = getFileSelectionState(file.path);
                  return (
                    <div key={file.path} className="border-b last:border-b-0">
                      {/* File row */}
                      <div className="flex items-center gap-1 px-2 py-1.5 hover:bg-muted/50">
                        <button
                          type="button"
                          onClick={() => onToggleFileExpand(file.path)}
                          className="flex-shrink-0 w-4 h-4 flex items-center justify-center text-muted-foreground hover:text-foreground"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-3 h-3" />
                          ) : (
                            <ChevronRight className="w-3 h-3" />
                          )}
                        </button>
                        <input
                          type="checkbox"
                          ref={(el) => {
                            if (el) el.indeterminate = fileState === "some";
                          }}
                          checked={fileState === "all"}
                          onChange={() => onToggleFileHunks(file.path)}
                          className="rounded flex-shrink-0"
                        />
                        <span
                          className={cn(
                            "text-xs font-mono w-4 text-center flex-shrink-0",
                            statusColor(file.status),
                          )}
                        >
                          {statusIcon(file.status)}
                        </span>
                        <span
                          className="text-xs truncate flex-1 cursor-pointer"
                          onClick={() => onToggleFileExpand(file.path)}
                        >
                          {file.path}
                        </span>
                      </div>
                      {/* Hunk rows */}
                      {isExpanded && (
                        <div>
                          {hunkData?.isLoading ? (
                            <div className="flex items-center gap-2 px-8 py-2 text-xs text-muted-foreground bg-muted/10">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Loading hunks...
                            </div>
                          ) : !hunkData || hunkData.hunks.length === 0 ? (
                            <div className="px-8 py-1.5 text-xs text-muted-foreground bg-muted/10">
                              No hunks
                            </div>
                          ) : (
                            hunkData.hunks.map((hunk) => {
                              const key = hunkKey(file.path, hunk.id);
                              return (
                                <label
                                  key={hunk.id}
                                  className="flex items-start gap-2 px-8 py-1.5 hover:bg-muted/30 cursor-pointer bg-muted/10 border-t border-border/30"
                                >
                                  <input
                                    type="checkbox"
                                    checked={selectedHunks.has(key)}
                                    onChange={() => onToggleHunk(key)}
                                    className="rounded flex-shrink-0 mt-0.5"
                                  />
                                  <div className="flex flex-col min-w-0 overflow-hidden">
                                    <span className="text-xs font-mono text-blue-400 truncate">
                                      {hunk.header}
                                    </span>
                                    {hunk.lines.slice(0, 3).map((line, i) => (
                                      <span
                                        key={i}
                                        className={cn(
                                          "text-xs font-mono truncate",
                                          line.startsWith("+")
                                            ? "text-green-500"
                                            : line.startsWith("-")
                                              ? "text-red-500"
                                              : "text-muted-foreground",
                                        )}
                                      >
                                        {line}
                                      </span>
                                    ))}
                                    {hunk.lines.length > 3 && (
                                      <span className="text-xs text-muted-foreground">
                                        +{hunk.lines.length - 3} more lines
                                      </span>
                                    )}
                                  </div>
                                </label>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            {changedFiles.length > 0 && (
              <div className="flex gap-2 mt-1.5">
                <button
                  type="button"
                  onClick={onSelectAllHunks}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={onClearHunks}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1.5">
              Select file changes to move to the new workspace
            </p>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
};
