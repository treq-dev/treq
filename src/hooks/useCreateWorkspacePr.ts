import { openUrl } from "@tauri-apps/plugin-opener";
import { ghCreatePr } from "../lib/api";
import { invalidateQueries } from "../lib/swr-cache";
import { useToastStore } from "../stores/toastStore";
import {
  createPrMutationKey,
  invalidatePrStatuses,
} from "./useMergeQueueStatus";
import { useMutation } from "./useMutation";

/** The commit landed but the push before PR creation failed. */
export class PushAfterCommitError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "PushAfterCommitError";
  }
}

export interface CreateWorkspacePrRequest {
  repoFullName: string;
  branchName: string;
  baseBranch: string;
  body: string;
  draft: boolean;
  // Commit/push before creating; resolves to the title, or null if it already reported a failure.
  prepare: () => Promise<string | null>;
}

/**
 * Create a PR for a workspace branch. Every create-PR surface for a
 * workspace shares one mutation key, so a create started from one shows as
 * pending in the others.
 */
export function useCreateWorkspacePr(
  repoPath: string | undefined,
  workspaceId: number | null | undefined,
) {
  const addToast = useToastStore((s) => s.addToast);
  const mutation = useMutation({
    mutationKey: createPrMutationKey(repoPath, workspaceId),
    mutationFn: async (request: CreateWorkspacePrRequest) => {
      const title = await request.prepare();
      if (title == null) return null;
      const number = await ghCreatePr(
        request.repoFullName,
        title,
        request.body,
        request.baseBranch,
        request.branchName,
        request.draft,
      );
      // Stay pending until the PR is cached, or a second click re-creates it.
      if (repoPath) await invalidatePrStatuses(repoPath, request.branchName);
      return number;
    },
  });

  const createPr = async (
    request: CreateWorkspacePrRequest,
  ): Promise<number | null> => {
    try {
      const number = await mutation.mutateAsync(request);
      if (number == null) return null;
      // Broad refresh so `not_on_remote` and sync status update everywhere.
      void invalidateQueries();
      const prUrl = `https://github.com/${request.repoFullName}/pull/${number}`;
      addToast({
        title: request.draft ? "Draft PR created" : "Pull request created",
        description: `#${number}`,
        type: "success",
        action: {
          label: "Open in Web",
          onClick: () => openUrl(prUrl),
        },
      });
      return number;
    } catch (error) {
      addToast({
        title:
          error instanceof PushAfterCommitError
            ? "Committed, but failed to push"
            : "Failed to create PR",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
      return null;
    }
  };

  return { createPr, isPending: mutation.isPending };
}
