import { useIsMutating, useMutation } from "../hooks/useMutation";
import { invalidateQueries } from "../lib/swr-cache";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ChevronDown, Github, Loader2 } from "lucide-react";
import { useState } from "react";
import {
  createPrMutationKey,
  invalidatePrStatuses,
  useGitRemoteInfo,
  usePrInfoViaGh,
} from "../hooks/useMergeQueueStatus";
import { ghCreatePr, pushWorkspaceToRemote } from "../lib/api";
import type { Workspace } from "../lib/api-types";
import {
  buildGitHubComparePrUrl,
  deriveConventionalPrTitle,
} from "../lib/github-pr";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { useToast } from "./ui/toast";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

interface CreatePrButtonGroupProps {
  repoPath: string;
  workspace: Workspace;
  baseBranch: string;
  hasCommits: boolean;
  needsPush: boolean;
}

export function CreatePrButtonGroup({
  repoPath,
  workspace,
  baseBranch,
  hasCommits,
  needsPush,
}: CreatePrButtonGroupProps) {
  const { addToast } = useToast();
  const { data: remoteInfo } = useGitRemoteInfo(repoPath);
  const { data: prInfo, isLoading: prInfoLoading } = usePrInfoViaGh(
    repoPath,
    workspace.branch_name,
  );
  const [pushingManually, setPushingManually] = useState(false);
  const title = deriveConventionalPrTitle(
    workspace.title ?? "",
    workspace.branch_name,
  );
  const body = workspace.description ?? "";

  // Shared across surfaces (this button and the Changes tab's "Commit and
  // create PR" dropdown item) so either one's in-flight PR creation shows
  // as pending here too.
  const createPrMutation = useMutation({
    mutationKey: createPrMutationKey(repoPath, workspace.id),
    mutationFn: async (draft: boolean) => {
      if (!remoteInfo) throw new Error("No GitHub remote detected");
      if (needsPush) {
        await pushWorkspaceToRemote(repoPath, workspace.id);
      }
      return ghCreatePr(
        remoteInfo.full_name,
        title,
        body,
        baseBranch,
        workspace.branch_name,
        draft,
      );
    },
  });
  const otherCreatePrActive = useIsMutating(
    createPrMutationKey(repoPath, workspace.id),
  );

  if (!remoteInfo || prInfoLoading || prInfo) {
    return null;
  }

  const createPr = async (draft: boolean) => {
    try {
      const number = await createPrMutation.mutateAsync(draft);
      await invalidatePrStatuses(repoPath, workspace.branch_name);
      // Broad refresh so `not_on_remote`/sync status update everywhere,
      // matching the existing manual "Push to remote" flow.
      void invalidateQueries();
      const prUrl = `https://github.com/${remoteInfo.full_name}/pull/${number}`;
      addToast({
        title: draft ? "Draft PR created" : "Pull request created",
        description: `#${number}`,
        type: "success",
        action: {
          label: "Open in Web",
          onClick: () => openUrl(prUrl),
        },
      });
    } catch (err) {
      addToast({
        title: "Failed to create PR",
        description: (err as Error).message,
        type: "error",
      });
    }
  };

  const openManual = async () => {
    setPushingManually(true);
    try {
      if (needsPush) {
        await pushWorkspaceToRemote(repoPath, workspace.id);
        void invalidateQueries();
      }
      openUrl(
        buildGitHubComparePrUrl({
          owner: remoteInfo.owner,
          repo: remoteInfo.repo,
          baseBranch,
          headBranch: workspace.branch_name,
          title,
          body,
        }),
      );
    } catch (err) {
      addToast({
        title: "Failed to push branch",
        description: (err as Error).message,
        type: "error",
      });
    } finally {
      setPushingManually(false);
    }
  };

  const creating = otherCreatePrActive || pushingManually;
  const pushAndCreate = needsPush;
  const disabled = creating || !hasCommits;
  const noCommitsTooltip =
    "Make a commit before creating a pull request. Uncommitted working-copy changes don't count.";

  return (
    <TooltipProvider delay={200}>
      <div className="inline-flex items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="default"
              size="sm"
              className="gap-1 rounded-r-none bg-[#24292f] text-white hover:bg-[#1b1f23] dark:border-white/30"
              disabled={disabled}
              onClick={() => createPr(false)}
            >
              {creating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Github className="w-4 h-4" />
              )}
              {creating
                ? pushAndCreate
                  ? "Pushing & creating…"
                  : "Creating…"
                : "Create PR"}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {!hasCommits
              ? noCommitsTooltip
              : pushAndCreate
                ? "Push this branch and create a pull request on GitHub"
                : "Create a pull request on GitHub"}
          </TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="default"
                  size="sm"
                  className="rounded-l-none border-l border-white/20 px-1.5 bg-[#24292f] text-white hover:bg-[#1b1f23] dark:border-white/30"
                  disabled={disabled}
                  aria-label="More Create PR options"
                >
                  <ChevronDown className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>
              {!hasCommits ? noCommitsTooltip : "More pull request options"}
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" sideOffset={4}>
            <DropdownMenuItem
              disabled={disabled}
              onSelect={() => void createPr(true)}
            >
              Create draft PR
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={disabled}
              onSelect={() => void openManual()}
            >
              Create PR manually
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </TooltipProvider>
  );
}
