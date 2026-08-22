import { ChevronDown, ChevronRight, Eye, EyeOff } from "lucide-react";
import { GitFileRow } from "./GitFileRow";
import type { JjFileChange } from "../lib/api";
import { cn } from "../lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

export interface CommittedChangesSectionProps {
  files: JjFileChange[];
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  activeFilePath: string | null;
  onFileSelect: (path: string, event: React.MouseEvent) => void;
  workspacePath?: string;
  /** When provided with onToggleShowCommitted, renders a right-aligned Show control. */
  showCommittedChanges?: boolean;
  onToggleShowCommitted?: () => void;
  /** Paths that stay listed when Show is off (WC-dirty or conflicted). */
  alwaysVisiblePaths?: ReadonlySet<string>;
}

export const CommittedChangesSection = ({
  files,
  isCollapsed,
  onToggleCollapse,
  activeFilePath,
  onFileSelect,
  workspacePath,
  showCommittedChanges = true,
  onToggleShowCommitted,
  alwaysVisiblePaths,
}: CommittedChangesSectionProps) => {
  // Don't render if no files
  if (files.length === 0) {
    return null;
  }

  const visibleFiles = showCommittedChanges
    ? files
    : files.filter((file) => alwaysVisiblePaths?.has(file.path));
  const showFiles = !isCollapsed && visibleFiles.length > 0;

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between w-full text-sm uppercase tracking-wide text-muted-foreground">
        <button
          type="button"
          className="flex items-center gap-1 hover:text-foreground transition-colors"
          onClick={onToggleCollapse}
        >
          {isCollapsed ? (
            <ChevronRight className="w-3 h-3" />
          ) : (
            <ChevronDown className="w-3 h-3" />
          )}
          <span>Committed</span>
          <span className="ml-1">{files.length}</span>
        </button>
        {onToggleShowCommitted ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "flex items-center gap-1 normal-case tracking-normal text-xs px-1.5 py-0.5 rounded transition-colors ml-auto",
                    showCommittedChanges
                      ? "text-blue-700 dark:text-blue-300 hover:bg-blue-500/20"
                      : "text-muted-foreground hover:text-foreground hover:bg-foreground/10",
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleShowCommitted();
                  }}
                  aria-pressed={showCommittedChanges}
                  aria-label="Show"
                >
                  {showCommittedChanges ? (
                    <Eye className="w-3.5 h-3.5" />
                  ) : (
                    <EyeOff className="w-3.5 h-3.5" />
                  )}
                  Show
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {showCommittedChanges
                    ? "Hide committed changes"
                    : "Show committed changes"}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null}
      </div>
      {showFiles && (
        <div className="mt-2 overflow-hidden select-none font-sans">
          {visibleFiles.map((file) => (
            <GitFileRow
              key={file.path}
              file={file}
              isSelected={false}
              isActive={activeFilePath === file.path}
              isLastSelected={false}
              readOnly={true}
              onFileClick={onFileSelect}
              workspacePath={workspacePath}
            />
          ))}
        </div>
      )}
    </div>
  );
};

CommittedChangesSection.displayName = "CommittedChangesSection";
