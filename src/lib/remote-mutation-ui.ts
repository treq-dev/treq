import { create } from "zustand";
import type { MutationDispatchResult } from "./remote-dispatch";
import { invalidateQueries } from "./swr-cache";
import { peekActiveRepository, repositoryCacheKey } from "./active-repository";

interface RemoteMutationFeedbackState {
  ambiguousReason: string | null;
  lastStatus: MutationDispatchResult["status"] | null;
  report: (result: MutationDispatchResult) => void;
  clearAmbiguous: () => void;
}

export function invalidateRemoteRepositoryData() {
  const repo = peekActiveRepository();
  if (!repo) {
    void invalidateQueries(["workspaces"]);
    void invalidateQueries(["workspace-statuses"]);
    void invalidateQueries(["workspace-changed-files"]);
    void invalidateQueries(["workspace-diff"]);
    void invalidateQueries(["linear-commits"]);
    void invalidateQueries(["workspace-commits"]);
    return;
  }
  const key = repositoryCacheKey(repo);
  void invalidateQueries(["workspaces", key]);
  void invalidateQueries(["workspace-statuses", key]);
  void invalidateQueries(["workspace-changed-files"]);
  void invalidateQueries(["workspace-diff"]);
  void invalidateQueries(["linear-commits", key]);
  void invalidateQueries(["workspace-commits", key]);
  void invalidateQueries(["repo-branch", key]);
  void invalidateQueries(["repo-status", key]);
  void invalidateQueries(["remote-review"]);
  void invalidateQueries(["workspace-review-change-count"]);
}

export const useRemoteMutationFeedback = create<RemoteMutationFeedbackState>(
  (set) => ({
    ambiguousReason: null,
    lastStatus: null,
    report: (result) => {
      if (result.status === "ambiguous") {
        set({
          lastStatus: "ambiguous",
          ambiguousReason: result.reason,
        });
        return;
      }
      set({ lastStatus: result.status, ambiguousReason: null });
      invalidateRemoteRepositoryData();
    },
    clearAmbiguous: () => set({ ambiguousReason: null }),
  }),
);

export function applyMutationDispatchResult<T>(
  result: MutationDispatchResult<T>,
): T | undefined {
  useRemoteMutationFeedback.getState().report(result);
  if (result.status === "applied") return result.value;
  return undefined;
}
