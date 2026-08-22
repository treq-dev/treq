import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "../lib/utils";

export interface ConflictsSectionProps {
  files: string[];
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onFileSelect?: (path: string) => void;
  activeFilePath?: string | null;
}

function formatFileLabel(filePath: string) {
  const parts = filePath.split("/");
  const name = parts.pop() || filePath;
  const directory = parts.length > 0 ? parts.join("/") : null;
  return { name, directory };
}

export const ConflictsSection = ({
  files,
  isCollapsed,
  onToggleCollapse,
  onFileSelect,
  activeFilePath,
}: ConflictsSectionProps) => {
  if (files.length === 0) {
    return null;
  }

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between w-full text-sm uppercase tracking-wide text-destructive">
        <button
          type="button"
          className="flex items-center gap-1 hover:text-destructive/80 transition-colors"
          onClick={onToggleCollapse}
        >
          {isCollapsed ? (
            <ChevronRight className="w-3 h-3" />
          ) : (
            <ChevronDown className="w-3 h-3" />
          )}
          <span>Conflicts</span>
        </button>
        <span className="ml-1">{files.length}</span>
      </div>
      {!isCollapsed && (
        <div className="mt-2 overflow-hidden select-none font-sans">
          {files.map((file, index) => {
            const label = formatFileLabel(file);
            return (
              <div
                key={`${file}-${index}`}
                className={cn(
                  "group/row relative py-1 text-sm flex items-center gap-1 cursor-pointer",
                  activeFilePath === file
                    ? "bg-accent/40"
                    : "hover:bg-accent/30",
                )}
                onClick={() => onFileSelect?.(file)}
                title={file}
              >
                <div className="ml-1 flex-1 flex items-center gap-2 min-w-0 font-sans">
                  <span
                    className={cn(
                      "font-medium truncate flex-shrink-0",
                      activeFilePath === file && "text-destructive",
                    )}
                  >
                    {label.name}
                  </span>
                  {label.directory && (
                    <span
                      className={cn(
                        "text-muted-foreground/60 truncate text-xs",
                        activeFilePath === file && "text-destructive/70",
                      )}
                    >
                      {label.directory}
                    </span>
                  )}
                </div>
                <span className="text-sm font-sans min-w-[1ch] text-destructive mr-1">
                  C
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

ConflictsSection.displayName = "ConflictsSection";
