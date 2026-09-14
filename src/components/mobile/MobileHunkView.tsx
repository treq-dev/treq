import { cn } from "../../lib/utils";
import type { JjDiffHunk } from "../../lib/api";

interface MobileHunkViewProps {
  hunk: JjDiffHunk;
}

function lineClass(line: string): string {
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return "bg-red-500/10 text-red-700 dark:text-red-400";
  }
  return "text-foreground";
}

/** Read-only, touch-first rendering of a single diff hunk. */
export function MobileHunkView({ hunk }: MobileHunkViewProps) {
  return (
    <div className="rounded-md border overflow-x-auto">
      <div className="border-b bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
        {hunk.header}
      </div>
      <pre className="text-xs leading-5">
        {hunk.lines.map((line, index) => (
          <div
            key={index}
            className={cn("whitespace-pre px-2", lineClass(line))}
          >
            {line}
          </div>
        ))}
      </pre>
    </div>
  );
}
