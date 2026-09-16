import useSWR from "swr";
import { Bot } from "lucide-react";
import {
  getWorkspaceDiff,
  getWorkspaceFileHunksBatch,
  type JjFileDiff,
} from "../../lib/api";
import { AgentReviewContext } from "../changes-diff-viewer/AgentReviewContext";
import { useAgentReviewComments } from "../changes-diff-viewer/hooks/useAgentReviewComments";
import { AGENT_REVIEW_TARGET_WORKSPACE_DIFF } from "../../lib/api-types-review";
import { useToast } from "../ui/toast";
import { MobileFileDiffList } from "./MobileFileDiffList";

interface MobileDiffViewProps {
  repoPath: string;
  workspaceId: number;
}

/**
 * Working-copy diff view for the mobile shell. Read-only for the diff itself,
 * but local agent review comments (left by a review run elsewhere, e.g.
 * desktop or CLI) render inline and can be resolved, deleted, or applied from
 * here too — mobile has no local terminal to launch a new review from, so
 * "Start Review" has no mobile equivalent, but acting on existing comments
 * does not need one.
 */
export function MobileDiffView({ repoPath, workspaceId }: MobileDiffViewProps) {
  const { addToast } = useToast();
  const { data, error, isLoading } = useSWR(
    ["mobile-workspace-diff", repoPath, workspaceId],
    () => getWorkspaceDiff(repoPath, workspaceId),
  );
  const {
    openAgentReviewComments,
    getAgentCommentsForLine,
    resolveAgentComment,
    deleteAgentComment,
    applyAgentSuggestion,
  } = useAgentReviewComments({
    repoPath,
    targetType: AGENT_REVIEW_TARGET_WORKSPACE_DIFF,
    targetId: String(workspaceId),
  });
  const handleAgentCommentError = (message: string) =>
    addToast({ title: "Review comment failed", description: message, type: "error" });

  // hunks_by_file only covers committed_files; uncommitted (working-copy)
  // files need their own hunk fetch (see workspace_diff_with_conflict_style
  // in src-tauri/src/core/workspaces.rs).
  const uncommittedPaths = (data?.uncommitted_files ?? []).map((f) => f.path);
  const { data: uncommittedHunks } = useSWR(
    uncommittedPaths.length > 0
      ? [
          "mobile-workspace-uncommitted-hunks",
          repoPath,
          workspaceId,
          uncommittedPaths,
        ]
      : null,
    () => getWorkspaceFileHunksBatch(repoPath, workspaceId, uncommittedPaths),
  );

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading changes…</p>;
  }
  if (error) {
    return <p className="text-sm text-destructive">{String(error)}</p>;
  }
  if (!data) {
    return null;
  }

  if (data.too_large_to_render) {
    return (
      <p className="text-sm text-muted-foreground">
        {data.render_block_reason ?? "This diff is too large to render."}
      </p>
    );
  }

  const files = [...data.committed_files, ...(data.uncommitted_files ?? [])];
  const uncommittedFileDiffs: JjFileDiff[] = (
    uncommittedHunks?.files ?? []
  ).map((f) => ({ path: f.path, hunks: f.hunks }));
  const hunksByFile = [...data.hunks_by_file, ...uncommittedFileDiffs];

  return (
    <AgentReviewContext.Provider
      value={{
        getAgentCommentsForLine,
        resolveAgentComment,
        deleteAgentComment,
        applyAgentSuggestion,
        onAgentCommentError: handleAgentCommentError,
      }}
    >
      <div className="flex flex-col gap-4">
        {openAgentReviewComments.length > 0 && (
          <div
            data-testid="mobile-agent-review-comment-count"
            className="flex items-center gap-1.5 text-xs text-violet-600 dark:text-violet-400"
          >
            <Bot className="w-3.5 h-3.5" />
            {openAgentReviewComments.length} local review comment
            {openAgentReviewComments.length !== 1 ? "s" : ""}
          </div>
        )}
        <MobileFileDiffList
          files={files}
          hunksByFile={hunksByFile}
          emptyLabel="No changes in this workspace."
        />
      </div>
    </AgentReviewContext.Provider>
  );
}
