import { cn } from "../../lib/utils";
import type { ConflictRegion } from "../../lib/api";

interface MobileConflictRegionViewProps {
  region: ConflictRegion;
}

function roleClass(role: string): string {
  switch (role) {
    case "left":
      return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
    case "right":
      return "bg-blue-500/10 text-blue-700 dark:text-blue-400";
    case "base":
      return "bg-amber-500/10 text-amber-700 dark:text-amber-400";
    default:
      return "text-muted-foreground";
  }
}

/** Read-only rendering of a single conflict region's markers/content. */
export function MobileConflictRegionView({
  region,
}: MobileConflictRegionViewProps) {
  return (
    <div className="rounded-md border overflow-x-auto">
      <div className="border-b bg-muted px-2 py-1 text-xs text-muted-foreground">
        Conflict {region.conflict_number} of {region.total_conflicts}
      </div>
      <pre className="text-xs leading-5">
        {region.lines.map((line, index) => (
          <div
            key={index}
            className={cn(
              "whitespace-pre px-2",
              line.kind === "marker"
                ? "font-semibold text-muted-foreground"
                : roleClass(line.role),
            )}
          >
            {line.raw}
          </div>
        ))}
      </pre>
    </div>
  );
}
