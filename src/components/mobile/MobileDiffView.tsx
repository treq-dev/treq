import useSWR from "swr";
import {
  getWorkspaceDiff,
  getWorkspaceFileHunksBatch,
  type JjFileDiff,
} from "../../lib/api";
import { MobileFileDiffList } from "./MobileFileDiffList";

interface MobileDiffViewProps {
  repoPath: string;
  workspaceId: number;
}

/** Read-only working-copy diff view for the mobile shell. */
export function MobileDiffView({ repoPath, workspaceId }: MobileDiffViewProps) {
  const { data, error, isLoading } = useSWR(
    ["mobile-workspace-diff", repoPath, workspaceId],
    () => getWorkspaceDiff(repoPath, workspaceId),
  );

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
    <div className="flex flex-col gap-4">
      <MobileFileDiffList
        files={files}
        hunksByFile={hunksByFile}
        emptyLabel="No changes in this workspace."
      />
    </div>
  );
}
