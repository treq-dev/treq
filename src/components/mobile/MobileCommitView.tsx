import { useState } from "react";
import useSWR from "swr";
import { ArrowLeft } from "lucide-react";
import { getCommitDiff } from "../../lib/api";
import { LinearCommitHistory } from "../LinearCommitHistory";
import { MobileFileDiffList } from "./MobileFileDiffList";

interface MobileCommitViewProps {
  repoPath: string;
  workspaceId: number;
}

/** Commit history with drill-down into a single commit's diff, mobile-shell layout. */
export function MobileCommitView({
  repoPath,
  workspaceId,
}: MobileCommitViewProps) {
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(null);

  if (selectedChangeId) {
    return (
      <MobileCommitDiff
        repoPath={repoPath}
        workspaceId={workspaceId}
        changeId={selectedChangeId}
        onBack={() => setSelectedChangeId(null)}
      />
    );
  }

  return (
    <LinearCommitHistory
      repoPath={repoPath}
      workspaceId={workspaceId}
      onCommitClick={setSelectedChangeId}
    />
  );
}

interface MobileCommitDiffProps {
  repoPath: string;
  workspaceId: number;
  changeId: string;
  onBack: () => void;
}

function MobileCommitDiff({
  repoPath,
  workspaceId,
  changeId,
  onBack,
}: MobileCommitDiffProps) {
  const { data, error, isLoading } = useSWR(
    ["mobile-commit-diff", repoPath, workspaceId, changeId],
    () => getCommitDiff(repoPath, workspaceId, changeId),
  );

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        onClick={onBack}
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to history
      </button>

      {isLoading && (
        <p className="text-sm text-muted-foreground">Loading diff…</p>
      )}
      {error && <p className="text-sm text-destructive">{String(error)}</p>}
      {data &&
        (data.too_large_to_render ? (
          <p className="text-sm text-muted-foreground">
            {data.render_block_reason ?? "This diff is too large to render."}
          </p>
        ) : (
          <MobileFileDiffList
            files={data.committed_files}
            hunksByFile={data.hunks_by_file}
            emptyLabel="This commit has no file changes."
          />
        ))}
    </div>
  );
}
