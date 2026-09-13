import { usePrCiStatus } from "../hooks/useMergeQueueStatus";
import type { PrCiStatus } from "../lib/api-types";
import {
  ciStateForBucket,
  ciStatusStyle,
  compareCiChecksBySeverity,
} from "../lib/ci-status";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { CheckEntryRow } from "./github-panel/shared";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

/**
 * Compact "passed/total" pill for a PR's rolled-up CI status. Pure/presentational
 * so it can be reused anywhere a `PrCiStatus` is already in hand -- the
 * workspace header (via `CiStatusIndicator` below, which fetches by branch)
 * and the GitHub panel's PR detail view (which fetches by PR number).
 */
export function CiStatusButton({ ciStatus }: { ciStatus: PrCiStatus }) {
  const style = ciStatusStyle(ciStatus.state);
  const { Icon } = style;
  const failingChecks = ciStatus.checks.filter(
    (check) => ciStateForBucket(check.bucket) === "failure",
  );
  const checks = [...ciStatus.checks].sort(compareCiChecksBySeverity);

  return (
    <Popover>
      <TooltipProvider delay={200}>
        <Tooltip>
          <PopoverTrigger asChild>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn("gap-1 px-2", style.buttonClassName)}
                aria-label={`${style.label}: ${ciStatus.passed}/${ciStatus.total} checks passed`}
              >
                <Icon
                  className={cn(
                    "w-4 h-4",
                    ciStatus.state === "pending" && "animate-spin",
                  )}
                />
                {ciStatus.passed}/{ciStatus.total}
              </Button>
            </TooltipTrigger>
          </PopoverTrigger>
          <TooltipContent>
            <div>
              {style.label}: {ciStatus.passed}/{ciStatus.total} checks passed
            </div>
            {failingChecks.length > 0 && (
              <div className="mt-1 text-xs opacity-80">
                Failing: {failingChecks.map((check) => check.name).join(", ")}
              </div>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent align="end" className="w-80 p-2">
        <div className="px-2 pb-1 text-xs font-medium text-muted-foreground">
          Checks
        </div>
        <div className="max-h-80 overflow-y-auto">
          {checks.map((check, index) => (
            <CheckEntryRow key={`${check.name}-${index}`} check={check} />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface CiStatusIndicatorProps {
  repoPath: string;
  branchName: string;
}

export function CiStatusIndicator({
  repoPath,
  branchName,
}: CiStatusIndicatorProps) {
  const { data: ciStatus } = usePrCiStatus(repoPath, branchName);

  if (!ciStatus || ciStatus.total === 0) {
    return null;
  }

  return <CiStatusButton ciStatus={ciStatus} />;
}
