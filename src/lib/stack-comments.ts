import type { ToastState } from "../stores/toastStore";
import { ghSyncStackComments } from "./api";

export interface CreatedPr {
  repoPath: string;
  repoFullName: string;
  headBranch: string;
}

/**
 * Posts or refreshes the stack comment on a newly created PR and the rest of
 * its stack. The PR already exists by then, so a failure only shows a
 * warning toast.
 */
export async function syncStackCommentsAfterPrCreate(
  { repoPath, repoFullName, headBranch }: CreatedPr,
  addToast: ToastState["addToast"],
): Promise<void> {
  try {
    await ghSyncStackComments(repoPath, repoFullName, headBranch);
  } catch (error) {
    addToast({
      title: "Stack comment not updated",
      description: error instanceof Error ? error.message : String(error),
      type: "warning",
    });
  }
}
