import type * as React from "react";
import { ArrowDown } from "lucide-react";
import { cn } from "../lib/utils";

interface StackTrackProps {
  /** Branch the stack lands on, shown under an arrow as the last row. */
  baseBranch: string;
  /** `<li>` rows, tip first. */
  children: React.ReactNode;
}

/**
 * The vertical track shared by stack cards: a connecting line behind the
 * rows and the base branch at the bottom.
 */
export function StackTrack({ baseBranch, children }: StackTrackProps) {
  return (
    <div className="relative">
      <div
        className="absolute left-[7px] top-2 bottom-2 w-0.5 bg-border"
        aria-hidden="true"
      />
      <ul className="space-y-0">
        {children}
        <li>
          <div className="relative z-10 flex w-full items-start gap-3 py-2 px-2 -mx-2 text-muted-foreground">
            <div className="flex-shrink-0 mt-0.5 w-[14px] h-[14px] flex items-center justify-center">
              <ArrowDown className="w-3.5 h-3.5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-mono truncate">{baseBranch}</p>
            </div>
          </div>
        </li>
      </ul>
    </div>
  );
}

export function StackDot({ highlighted }: { highlighted: boolean }) {
  return (
    <div className="flex-shrink-0 mt-0.5">
      <div
        className={cn(
          "w-[14px] h-[14px] rounded-full border-2 border-background",
          highlighted ? "bg-primary" : "bg-muted-foreground",
        )}
      />
    </div>
  );
}
