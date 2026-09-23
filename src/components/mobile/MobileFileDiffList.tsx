import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "../../lib/utils";
import type { JjFileChange, JjFileDiff } from "../../lib/api";
import { MobileHunkView } from "./MobileHunkView";

interface MobileFileDiffListProps {
  files: JjFileChange[];
  hunksByFile: JjFileDiff[];
  emptyLabel: string;
}

/** Collapsible, touch-first file list with inline hunks per file. */
export function MobileFileDiffList({
  files,
  hunksByFile,
  emptyLabel,
}: MobileFileDiffListProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (files.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  const hunksByPath = new Map(hunksByFile.map((f) => [f.path, f]));

  return (
    <ul className="flex flex-col gap-2">
      {files.map((file) => {
        const isOpen = expanded.has(file.path);
        const fileDiff = hunksByPath.get(file.path);
        return (
          <li key={file.path} className="rounded-md border">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
              onClick={() =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(file.path)) next.delete(file.path);
                  else next.add(file.path);
                  return next;
                })
              }
            >
              {isOpen ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <span
                className={cn(
                  "shrink-0 font-mono text-xs uppercase text-muted-foreground",
                )}
              >
                {file.status}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono">
                {file.path}
              </span>
            </button>
            {isOpen && (
              <div className="flex flex-col gap-2 border-t px-2 py-2">
                {fileDiff && fileDiff.hunks.length > 0 ? (
                  fileDiff.hunks.map((hunk) => (
                    <MobileHunkView
                      key={hunk.id}
                      hunk={hunk}
                      filePath={file.path}
                    />
                  ))
                ) : (
                  <p className="px-1 py-1 text-xs text-muted-foreground">
                    No diff available for this file.
                  </p>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
