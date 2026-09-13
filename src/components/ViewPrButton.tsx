import {
  ExternalLink,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  type LucideIcon,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { usePrInfoViaGh, useGitRemoteInfo } from "../hooks/useMergeQueueStatus";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

interface ViewPrButtonProps {
  repoPath: string;
  branchName: string;
  onViewInApp?: (prNumber: number, prState: string) => void;
}

const PR_STATUS_STYLES: Record<
  string,
  { label: string; className: string; Icon: LucideIcon }
> = {
  OPEN: {
    label: "View PR",
    className:
      "border-green-600 text-green-700 hover:bg-green-600/10 hover:text-green-700 dark:text-green-400 dark:border-green-500",
    Icon: GitPullRequest,
  },
  CLOSED: {
    label: "View PR",
    className:
      "border-red-600 text-red-700 hover:bg-red-600/10 hover:text-red-700 dark:text-red-400 dark:border-red-500",
    Icon: GitPullRequestClosed,
  },
  MERGED: {
    label: "View PR",
    className:
      "border-purple-600 text-purple-700 hover:bg-purple-600/10 hover:text-purple-700 dark:text-purple-400 dark:border-purple-500",
    Icon: GitMerge,
  },
};

export function ViewPrButton({
  repoPath,
  branchName,
  onViewInApp,
}: ViewPrButtonProps) {
  const { data: remoteInfo } = useGitRemoteInfo(repoPath);
  const { data: prInfo, isLoading } = usePrInfoViaGh(repoPath, branchName);

  if (!remoteInfo || isLoading || !prInfo) {
    return null;
  }

  const style = PR_STATUS_STYLES[prInfo.state] ?? PR_STATUS_STYLES.OPEN;
  const Icon = prInfo.is_draft ? GitPullRequestDraft : style.Icon;
  const statusLabel = prInfo.is_draft ? "draft" : prInfo.state.toLowerCase();

  return (
    <TooltipProvider delay={200}>
      <div className="inline-flex items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn("gap-1 rounded-r-none", style.className)}
              onClick={() => {
                if (onViewInApp) {
                  onViewInApp(prInfo.number, prInfo.state);
                } else {
                  openUrl(prInfo.url);
                }
              }}
              aria-label={`View PR (#${prInfo.number}, ${statusLabel})`}
            >
              <Icon className="w-4 h-4" />
              {style.label}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            View pull request #{prInfo.number} in Treq
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn("rounded-l-none border-l-0 px-2", style.className)}
              onClick={() => openUrl(prInfo.url)}
              aria-label="Open PR on web"
            >
              <ExternalLink className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Open pull request #{prInfo.number} on GitHub
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
