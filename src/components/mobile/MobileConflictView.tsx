import { useState } from "react";
import useSWR from "swr";
import { ArrowLeft } from "lucide-react";
import { getWorkspaceFileHunks, getWorkspaceStatus } from "../../lib/api";
import { ConflictsSection } from "../ConflictsSection";
import { MobileConflictRegionView } from "./MobileConflictRegionView";
import { MobileHunkView } from "./MobileHunkView";

interface MobileConflictViewProps {
  repoPath: string;
  workspaceId: number;
}

/** Read-only conflicted-file list and viewer for the mobile shell. */
export function MobileConflictView({
  repoPath,
  workspaceId,
}: MobileConflictViewProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const {
    data: status,
    error,
    isLoading,
  } = useSWR(["mobile-workspace-status", repoPath, workspaceId], () =>
    getWorkspaceStatus(repoPath, workspaceId),
  );

  if (selectedPath) {
    return (
      <MobileConflictFile
        repoPath={repoPath}
        workspaceId={workspaceId}
        filePath={selectedPath}
        onBack={() => setSelectedPath(null)}
      />
    );
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading conflicts…</p>;
  }
  if (error) {
    return <p className="text-sm text-destructive">{String(error)}</p>;
  }
  if (!status || status.conflicted_files.length === 0) {
    return <p className="text-sm text-muted-foreground">No conflicts. Nice.</p>;
  }

  return (
    <ConflictsSection
      files={status.conflicted_files}
      isCollapsed={false}
      onToggleCollapse={() => {}}
      onFileSelect={setSelectedPath}
      activeFilePath={selectedPath}
    />
  );
}

interface MobileConflictFileProps {
  repoPath: string;
  workspaceId: number;
  filePath: string;
  onBack: () => void;
}

function MobileConflictFile({
  repoPath,
  workspaceId,
  filePath,
  onBack,
}: MobileConflictFileProps) {
  const {
    data: hunks,
    error,
    isLoading,
  } = useSWR(
    ["mobile-conflict-file-hunks", repoPath, workspaceId, filePath],
    () => getWorkspaceFileHunks(repoPath, workspaceId, filePath),
  );

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        onClick={onBack}
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to conflicts
      </button>
      <p className="truncate font-mono text-xs text-muted-foreground">
        {filePath}
      </p>

      {isLoading && (
        <p className="text-sm text-muted-foreground">Loading conflict…</p>
      )}
      {error && <p className="text-sm text-destructive">{String(error)}</p>}
      {hunks && (
        <div className="flex flex-col gap-2">
          {hunks.flatMap((hunk) =>
            hunk.conflict_regions && hunk.conflict_regions.length > 0
              ? hunk.conflict_regions.map((region) => (
                  <MobileConflictRegionView key={region.id} region={region} />
                ))
              : [<MobileHunkView key={hunk.id} hunk={hunk} />],
          )}
        </div>
      )}
    </div>
  );
}
