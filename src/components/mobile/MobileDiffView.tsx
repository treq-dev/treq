import useSWR from "swr";
import { getWorkspaceDiff } from "../../lib/api";
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

  return (
    <div className="flex flex-col gap-4">
      <MobileFileDiffList
        files={files}
        hunksByFile={data.hunks_by_file}
        emptyLabel="No changes in this workspace."
      />
    </div>
  );
}
