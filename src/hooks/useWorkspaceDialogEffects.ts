import { type Dispatch, type SetStateAction, useEffect } from "react";
import useSWR from "swr";
import {
  type BranchStatus,
  type JjDiffHunk,
  type JjFileChange,
  type Workspace,
  type WorkspaceStatus,
  checkBranchExists,
  getRepoSetting,
  getWorkspaceChangedFiles,
  getWorkspaceFileHunks,
  getWorkspaceStatus,
  getWorkspaces,
  jjGitFetchBackground,
  listRepoBranches,
} from "../lib/api";
import type { BranchListItem } from "../components/TargetBranchSelector";
import { applyBranchNamePattern } from "../lib/utils";
import type { WorkspaceDialogDefaults } from "../components/UnifiedWorkspaceDialog";
import { useDebounce } from "./useDebounce";

type HunkMap = Map<string, { hunks: JjDiffHunk[]; isLoading: boolean }>;

export interface UseWorkspaceDialogEffectsParams {
  open: boolean;
  repoPath: string;
  defaults: WorkspaceDialogDefaults;
  sourceWorkspace: Workspace | null;
  isHomeRepo: boolean;
  description: string;
  title: string;
  branchName: string;
  branchPattern: string;
  isEditingBranch: boolean;
  moveToExisting: boolean;
  isStackOnRoot: boolean;
  position: "before" | "after";
  fileHunksMap: HunkMap;
  setIntent: (v: string) => void;
  setTitle: (v: string) => void;
  setBranchName: (v: string) => void;
  setBranchPattern: (v: string) => void;
  setIsEditingBranch: (v: boolean) => void;
  setLoading: (v: boolean) => void;
  setError: (v: string) => void;
  setBranchStatusData: (v: BranchStatus | null) => void;
  setIsCheckingBranch: (v: boolean) => void;
  setTargetBranch: (v: string | null) => void;
  setAvailableBranches: (v: BranchListItem[]) => void;
  setBranchesLoading: (v: boolean) => void;
  setPosition: (v: "before" | "after") => void;
  setActiveRightTab: (v: "commits" | "changes") => void;
  setChangedFiles: (v: JjFileChange[]) => void;
  setFileHunksMap: Dispatch<SetStateAction<HunkMap>>;
  setExpandedFiles: Dispatch<SetStateAction<Set<string>>>;
  setSelectedHunks: Dispatch<SetStateAction<Set<string>>>;
  setWorkspaceStatus: (v: WorkspaceStatus | null) => void;
  setSelectedCommits: Dispatch<SetStateAction<Set<string>>>;
  setDataLoading: (v: boolean) => void;
  setAllWorkspaces: (v: Workspace[]) => void;
  setMoveToExisting: (v: boolean) => void;
  setTargetWorkspaceId: (v: number | null) => void;
}

function mapBranches(
  branches: { name: string; is_current: boolean }[],
): BranchListItem[] {
  return branches.map((b) => ({
    name: b.name,
    fullName: b.name,
    isCurrent: b.is_current,
  }));
}

export function useWorkspaceDialogEffects(
  params: UseWorkspaceDialogEffectsParams,
) {
  const {
    open,
    repoPath,
    defaults,
    sourceWorkspace,
    isHomeRepo,
    title,
    branchName,
    branchPattern,
    isEditingBranch,
    moveToExisting,
    isStackOnRoot,
    position,
    fileHunksMap,
    setIntent,
    setTitle,
    setBranchName,
    setBranchPattern,
    setIsEditingBranch,
    setLoading,
    setError,
    setBranchStatusData,
    setIsCheckingBranch,
    setTargetBranch,
    setAvailableBranches,
    setBranchesLoading,
    setPosition,
    setActiveRightTab,
    setChangedFiles,
    setFileHunksMap,
    setExpandedFiles,
    setSelectedHunks,
    setWorkspaceStatus,
    setSelectedCommits,
    setDataLoading,
    setAllWorkspaces,
    setMoveToExisting,
    setTargetWorkspaceId,
  } = params;

  useEffect(() => {
    if (!open) return;

    setError("");
    setBranchStatusData(null);
    setIsEditingBranch(false);
    setLoading(false);
    setMoveToExisting(false);
    setTargetWorkspaceId(null);

    if (defaults.activeTab) {
      setActiveRightTab(defaults.activeTab);
    } else {
      setActiveRightTab("commits");
    }

    const initIntent = defaults.description ?? "";
    setIntent(initIntent);
    setTitle(defaults.title ?? "");

    if (defaults.branchName) {
      setBranchName(defaults.branchName);
      setIsEditingBranch(true);
    } else {
      setBranchName("");
      setIsEditingBranch(false);
    }

    setTargetBranch(defaults.targetBranch ?? null);
    setSelectedHunks(new Set());
    setFileHunksMap(new Map());
    setExpandedFiles(new Set());
    setSelectedCommits(new Set(defaults.preSelectedCommits ?? []));
  }, [open]);

  const sourceId = sourceWorkspace?.id ?? null;
  const needsBranches = isHomeRepo || !defaults.targetBranch;
  const dialogMode = sourceWorkspace
    ? "source"
    : isHomeRepo
      ? "home"
      : "create";

  const { data: dialogData, isLoading: dialogLoading } = useSWR(
    open ? ["workspace-dialog-data", repoPath, dialogMode, sourceId] : null,
    async () => {
      if (dialogMode === "source" && sourceId != null) {
        const [status, files, workspaceList] = await Promise.all([
          getWorkspaceStatus(repoPath, sourceId),
          getWorkspaceChangedFiles(repoPath, sourceId),
          getWorkspaces(repoPath),
        ]);
        return {
          status,
          files,
          workspaceList,
          branches: null as BranchListItem[] | null,
        };
      }
      if (dialogMode === "home") {
        void jjGitFetchBackground(repoPath);
        const [files, workspaceList, branches] = await Promise.all([
          getWorkspaceChangedFiles(repoPath, null),
          getWorkspaces(repoPath),
          listRepoBranches(repoPath),
        ]);
        return {
          status: null,
          files,
          workspaceList,
          branches: mapBranches(branches),
        };
      }
      const workspaceList = await getWorkspaces(repoPath);
      let branches: BranchListItem[] | null = null;
      if (needsBranches) {
        void jjGitFetchBackground(repoPath);
        branches = mapBranches(await listRepoBranches(repoPath));
      }
      return {
        status: null,
        files: [] as JjFileChange[],
        workspaceList,
        branches,
      };
    },
  );

  useEffect(() => {
    setDataLoading(Boolean(open && dialogLoading && !dialogData));
    if (!open || !dialogData) return;
    setWorkspaceStatus(dialogData.status);
    setChangedFiles(dialogData.files);
    setAllWorkspaces(dialogData.workspaceList);
    if (dialogMode === "source" && sourceId != null) {
      const others = dialogData.workspaceList.filter((w) => w.id !== sourceId);
      if (others.length > 0) setTargetWorkspaceId(others[0].id);
    }
    if (dialogData.branches) {
      setAvailableBranches(dialogData.branches);
      setBranchesLoading(false);
    } else if (dialogMode !== "source") {
      setBranchesLoading(false);
    }
  }, [open, dialogData, dialogLoading, dialogMode, sourceId]);

  const { data: pattern } = useSWR(
    open && repoPath ? ["repo-setting", repoPath, "branch_name_pattern"] : null,
    () => getRepoSetting(repoPath, "branch_name_pattern"),
  );

  useEffect(() => {
    if (!open) return;
    setBranchPattern(pattern || "treq/{name}");
  }, [open, pattern]);

  useEffect(() => {
    if (!isEditingBranch && title.trim()) {
      setBranchName(applyBranchNamePattern(branchPattern, title));
    } else if (!isEditingBranch && !title.trim()) {
      setBranchName("");
    }
  }, [title, branchPattern, isEditingBranch]);

  const debouncedBranchName = useDebounce(branchName, 500);
  const { data: branchStatus, isLoading: checkingBranch } = useSWR(
    open && !moveToExisting && debouncedBranchName.trim()
      ? ["check-branch-exists", repoPath, debouncedBranchName]
      : null,
    () => checkBranchExists(repoPath, debouncedBranchName),
  );

  useEffect(() => {
    if (!debouncedBranchName.trim() || moveToExisting) {
      setBranchStatusData(null);
      setIsCheckingBranch(false);
      return;
    }
    setIsCheckingBranch(checkingBranch);
    if (branchStatus) setBranchStatusData(branchStatus);
  }, [debouncedBranchName, moveToExisting, checkingBranch, branchStatus]);

  useEffect(() => {
    if (isStackOnRoot && position !== "after") setPosition("after");
  }, [isStackOnRoot, position]);

  const pendingHunkPaths = [...fileHunksMap]
    .filter(([, data]) => data.isLoading && data.hunks.length === 0)
    .map(([filePath]) => filePath)
    .sort()
    .join("\0");

  const { data: loadedHunks } = useSWR(
    open && pendingHunkPaths
      ? [
          "workspace-dialog-hunks",
          repoPath,
          sourceWorkspace?.id ?? null,
          pendingHunkPaths,
        ]
      : null,
    async () => {
      const paths = pendingHunkPaths.split("\0");
      const entries = await Promise.all(
        paths.map(async (filePath) => {
          try {
            const hunks = await getWorkspaceFileHunks(
              repoPath,
              sourceWorkspace?.id ?? null,
              filePath,
            );
            return [filePath, hunks] as const;
          } catch {
            return [filePath, [] as JjDiffHunk[]] as const;
          }
        }),
      );
      return Object.fromEntries(entries) as Record<string, JjDiffHunk[]>;
    },
  );

  useEffect(() => {
    if (!loadedHunks) return;
    setFileHunksMap((prev) => {
      const next = new Map(prev);
      for (const [filePath, hunks] of Object.entries(loadedHunks)) {
        next.set(filePath, { hunks, isLoading: false });
      }
      return next;
    });
  }, [loadedHunks]);
}
