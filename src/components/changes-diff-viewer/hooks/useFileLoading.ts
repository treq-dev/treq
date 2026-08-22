import React, { useEffect, useRef, useState } from "react";
import {
  type JjDiffHunk,
  getDiffCache,
  getWorkspaceChangedFiles,
  getWorkspaceDiff,
  getWorkspaceFileHunks,
} from "../../../lib/api";
import {
  type ParsedFileChange,
  parseJjChangedFiles,
} from "../../../lib/git-utils";
import { useCachedWorkspaceChanges } from "../../../hooks/useCachedWorkspaceChanges";
import {
  REFRESH_WORKSPACE_CHANGES_EVENT,
  scheduleRefreshWorkspaceChanges,
} from "../../../lib/change-file-drag";
import type { WorkspaceChangesRefreshDetail } from "../../../lib/workspace-refresh";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { useToast } from "../../ui/toast";
import type { FileHunksData } from "../types";
import { hunksEqual, parseCachedHunks } from "../utils";
import { workspaceDiffCoalesce } from "../../../lib/coalesce-in-flight";

// One in-flight workspace_diff per process. jj WC locks are process-global.

interface UseFileLoadingParams {
  workspacePath: string;
  repoPath: string | undefined;
  workspaceId: number | undefined;
  showCommittedChanges: boolean | undefined;
  /** Backend conflicted-file hint — retained even when Committed is hidden. */
  conflictedFilesHint?: string[];
  onRefreshingChange: ((refreshing: boolean) => void) | undefined;
  /** Ref updated each render with current setLargeChangesetExpanded (breaks ordering dep) */
  setLargeChangesetExpandedRef: React.MutableRefObject<
    React.Dispatch<React.SetStateAction<boolean>>
  >;
  /** Ref updated each render with current applyChangedFiles (breaks circular dep) */
  applyChangedFilesRef: React.MutableRefObject<
    (parsed: ParsedFileChange[], forceApply?: boolean) => void
  >;
  /** Ref updated each render with current isInReviewMode (breaks circular dep) */
  isInReviewModeRef: React.MutableRefObject<boolean>;
  /** Ref updated each render with current setStaleFiles (breaks circular dep) */
  setStaleFilesRef: React.MutableRefObject<
    React.Dispatch<React.SetStateAction<Set<string>>>
  >;
  /** Ref updated each render with current setPendingHunksData (breaks circular dep) */
  setPendingHunksDataRef: React.MutableRefObject<
    React.Dispatch<React.SetStateAction<Map<string, FileHunksData> | null>>
  >;
  isReloadingRef: React.MutableRefObject<boolean>;
  addToast: ReturnType<typeof useToast>["addToast"];
}

export function useFileLoading({
  workspacePath,
  repoPath,
  workspaceId,
  showCommittedChanges,
  conflictedFilesHint = [],
  onRefreshingChange,
  setLargeChangesetExpandedRef,
  applyChangedFilesRef,
  isInReviewModeRef,
  setStaleFilesRef,
  setPendingHunksDataRef,
  isReloadingRef,
  addToast,
}: UseFileLoadingParams) {
  const [files, setFiles] = useState<ParsedFileChange[]>([]);
  const [allFileHunks, setAllFileHunks] = useState<Map<string, FileHunksData>>(
    new Map(),
  );
  const [loadingAllHunks, setLoadingAllHunks] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [, setRefreshing] = useState(false);
  const [committedFiles, setCommittedFiles] = useState<
    import("../../../lib/api").JjFileChange[]
  >([]);
  const [committedFileHunks, setCommittedFileHunks] = useState<
    Map<string, FileHunksData>
  >(new Map());
  // null until the first getWorkspaceDiff resolves — fall back to status hint.
  // After that, diff.conflicted_files is authoritative for Review Conflicts UI
  // so marker resolves clear before a stale workspace-status query refetches.
  const [liveConflictedFiles, setLiveConflictedFiles] = useState<
    string[] | null
  >(null);
  const prevFilePathsRef = useRef<string[]>([]);
  // Stabilize against default `[]` / new array identity each render — a changing
  // loadChangedFiles identity would retrigger the showCommittedChanges effect
  // in a loop and unmount the Review tree (empty <body /> in unit tests).
  const conflictedFilesHintRef = useRef(conflictedFilesHint);
  conflictedFilesHintRef.current = conflictedFilesHint;
  const conflictedFilesKey = conflictedFilesHint.join("\0");

  const cachedChanges = useCachedWorkspaceChanges(workspacePath, {
    enabled: true,
    repoPath: workspacePath,
    workspaceId: null,
  });

  const invalidateCache = async () => {
    await cachedChanges.refresh();
  };

  const refresh = () => {
    cachedChanges.refresh();
  };

  const pendingForceApplyRef = useRef(false);

  const loadChangedFiles = async (forceApply = false) => {
    if (forceApply) pendingForceApplyRef.current = true;
    await workspaceDiffCoalesce(async () => {
      const force = pendingForceApplyRef.current;
      pendingForceApplyRef.current = false;
      setRefreshing(true);
      onRefreshingChange?.(true);
      // User-initiated refreshes (e.g. commit) must apply through review-mode
      // freeze so the Review panel updates instead of showing the stale banner.
      if (force) {
        isReloadingRef.current = true;
      }
      try {
        if (repoPath && workspaceId !== undefined) {
          const diff = await getWorkspaceDiff(repoPath, workspaceId);
          const parsed = parseJjChangedFiles(diff.uncommitted_files ?? []);
          applyChangedFilesRef.current(parsed, force);

          const fromDiff = diff.conflicted_files ?? [];
          // Diff is authoritative for live conflict state. The status hint can
          // lag a frame behind resolve+commit; never re-introduce paths a fresh
          // diff reports as resolved.
          setLiveConflictedFiles(fromDiff);
          const conflictedHint = new Set<string>(fromDiff);
          const uncommittedPaths = new Set(parsed.map((file) => file.path));

          // Keep the full committed file list so the Committed section header
          // (and its Show toggle) stay available while committed diffs are hidden.
          // Conflicted paths that aren't already in the committed list are still
          // appended — rebase conflicts live in committed hunks.
          let committed = [...(diff.committed_files ?? [])];
          for (const path of conflictedHint) {
            if (
              uncommittedPaths.has(path) ||
              committed.some((file) => file.path === path)
            ) {
              continue;
            }
            committed = [
              ...committed,
              {
                path,
                status: "C",
                previous_path: null,
                changed_line_count: 0,
                diff_deferred: false,
              },
            ];
          }
          setCommittedFiles(committed);

          // When Committed is hidden, still keep dirty + conflicted committed hunks.
          const alwaysVisibleCommitted = new Set([
            ...uncommittedPaths,
            ...conflictedHint,
          ]);
          setCommittedFileHunks(
            new Map(
              (diff.hunks_by_file ?? [])
                .filter(
                  (fileDiff) =>
                    showCommittedChanges ||
                    alwaysVisibleCommitted.has(fileDiff.path),
                )
                .map((fileDiff) => [
                  fileDiff.path,
                  {
                    filePath: fileDiff.path,
                    hunks: fileDiff.hunks,
                    isLoading: false,
                  },
                ]),
            ),
          );
          return;
        }
        const jjFiles = await getWorkspaceChangedFiles(
          repoPath ?? "",
          workspaceId ?? null,
        );
        const parsed = parseJjChangedFiles(jjFiles);
        applyChangedFilesRef.current(parsed, force);
        setCommittedFiles([]);
        setCommittedFileHunks(new Map());
        setLiveConflictedFiles([]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        addToast({ description: message, title: "JJ Error", type: "error" });
      } finally {
        setInitialLoading(false);
        setRefreshing(false);
        onRefreshingChange?.(false);
        if (force) {
          // Keep the flag long enough for the files→hunks effect to apply.
          setTimeout(() => {
            isReloadingRef.current = false;
          }, 100);
        }
      }
    });
  };

  const loadChangedFilesRef = useRef(loadChangedFiles);
  loadChangedFilesRef.current = loadChangedFiles;

  // Call through the ref so toast/callback identity cannot retrigger this
  // effect. Including `loadChangedFiles` stacked overlapping getWorkspaceDiff
  // calls (jj WC lock) and unmounted the Review file list in later tests.
  // Wait for workspaceId: a null-id getWorkspaceChangedFiles can hold the jj
  // lock indefinitely, and the coalescer would then never run the real load.
  useEffect(() => {
    if (!workspacePath || workspaceId === undefined) return;
    void loadChangedFilesRef.current();
  }, [
    workspacePath,
    repoPath,
    workspaceId,
    showCommittedChanges,
    conflictedFilesKey,
  ]);

  useEffect(() => {
    if (!workspaceId) return;
    const unlisten = listen<{ workspace_id: number; changed_paths: string[] }>(
      "workspace-files-changed",
      (event) => {
        if (event.payload.workspace_id === workspaceId) {
          scheduleRefreshWorkspaceChanges({
            workspaceId,
            changedPaths: event.payload.changed_paths,
          });
        }
      },
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [workspaceId]);

  const refreshCommittedChanges = async () => {};

  const loadAllFileHunks = async (
    filesToLoad: ParsedFileChange[],
    forceApply = false,
  ) => {
    if (filesToLoad.length === 0) {
      if (!isInReviewModeRef.current || forceApply) {
        setAllFileHunks((prev) => (prev.size === 0 ? prev : new Map()));
      }
      setLoadingAllHunks(false);
      return;
    }
    setLoadingAllHunks(true);
    const cachedHunksMap = new Map<string, JjDiffHunk[]>();
    const hunksMap = new Map<string, FileHunksData>();
    await Promise.all(
      filesToLoad.map(async (file) => {
        try {
          const cache = await getDiffCache(
            workspacePath,
            "file_hunks",
            file.path,
          );
          if (cache?.data) {
            const hunks = parseCachedHunks(cache.data);
            if (hunks) {
              cachedHunksMap.set(file.path, hunks);
              hunksMap.set(file.path, {
                filePath: file.path,
                hunks,
                isLoading: false,
              });
            }
          }
        } catch {
          /* cache miss non-fatal */
        }
      }),
    );
    filesToLoad.forEach((file) => {
      if (!hunksMap.has(file.path))
        hunksMap.set(file.path, {
          filePath: file.path,
          hunks: [],
          isLoading: true,
        });
    });
    if (cachedHunksMap.size > 0 && (!isInReviewModeRef.current || forceApply)) {
      setAllFileHunks((prev) => {
        let needsUpdate = prev.size !== hunksMap.size;
        if (!needsUpdate) {
          for (const [path, data] of hunksMap) {
            const existing = prev.get(path);
            if (
              !existing ||
              existing.isLoading !== data.isLoading ||
              !hunksEqual(existing.hunks, data.hunks)
            ) {
              needsUpdate = true;
              break;
            }
          }
        }
        return needsUpdate ? new Map(hunksMap) : prev;
      });
    }
    try {
      const results = await Promise.all(
        filesToLoad.map(async (file) => {
          try {
            const hunks = await getWorkspaceFileHunks(
              repoPath ?? "",
              workspaceId ?? null,
              file.path,
            );
            return {
              filePath: file.path,
              hunks,
              error: null as string | null,
            };
          } catch (error) {
            return {
              filePath: file.path,
              hunks: [] as JjDiffHunk[],
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }),
      );
      if (isInReviewModeRef.current && !forceApply && !isReloadingRef.current) {
        const newHunksMap = new Map<string, FileHunksData>();
        const changedFiles = new Set<string>();
        for (const result of results) {
          const existing = allFileHunks.get(result.filePath);
          const newData: FileHunksData = result.error
            ? {
                error: result.error,
                filePath: result.filePath,
                hunks: [],
                isLoading: false,
              }
            : {
                filePath: result.filePath,
                hunks: result.hunks,
                isLoading: false,
              };
          newHunksMap.set(result.filePath, newData);
          if (!existing || !hunksEqual(existing.hunks, result.hunks))
            changedFiles.add(result.filePath);
        }
        if (changedFiles.size > 0) {
          setStaleFilesRef.current(
            (prev) => new Set([...prev, ...changedFiles]),
          );
          setPendingHunksDataRef.current(newHunksMap);
        }
        setLoadingAllHunks(false);
        return;
      }
      setAllFileHunks((prev) => {
        let hasChanges = false;
        const next = new Map(prev);
        for (const result of results) {
          const existing = prev.get(result.filePath);
          if (result.error) {
            if (!existing || existing.error !== result.error) {
              hasChanges = true;
              next.set(result.filePath, {
                error: result.error,
                filePath: result.filePath,
                hunks: [],
                isLoading: false,
              });
            }
            continue;
          }
          if (
            !existing ||
            existing.isLoading ||
            !hunksEqual(existing.hunks, result.hunks)
          ) {
            hasChanges = true;
            next.set(result.filePath, {
              filePath: result.filePath,
              hunks: result.hunks,
              isLoading: false,
            });
          }
        }
        return hasChanges ? next : prev;
      });
    } finally {
      setLoadingAllHunks(false);
    }
  };

  // File contents can change on disk without any jj-visible status change
  // (e.g. edits to an already-modified file), so the file watcher event
  // above isn't enough to keep an open diff fresh. Re-read everything from
  // disk whenever the window regains focus, so switching back to the app
  // never leaves the Changes tab showing what was there before you left.
  const loadAllFileHunksRef = useRef(loadAllFileHunks);
  loadAllFileHunksRef.current = loadAllFileHunks;
  const filesRef = useRef(files);
  filesRef.current = files;

  const refreshFromDisk = () => {
    void loadChangedFilesRef.current();
    if (filesRef.current.length > 0) {
      loadAllFileHunksRef.current(filesRef.current);
    }
  };

  useEffect(() => {
    const handler = (event: Event) => {
      const { detail } = event as CustomEvent<WorkspaceChangesRefreshDetail>;
      if (
        detail?.workspaceId !== undefined &&
        workspaceId !== undefined &&
        detail.workspaceId !== workspaceId
      ) {
        return;
      }
      refreshFromDisk();
    };
    window.addEventListener(REFRESH_WORKSPACE_CHANGES_EVENT, handler);
    return () => {
      window.removeEventListener(REFRESH_WORKSPACE_CHANGES_EVENT, handler);
    };
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (!focused) return;
        refreshFromDisk();
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {
        /* not running inside a Tauri window (e.g. tests) */
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [workspaceId]);

  useEffect(() => {
    const currentPaths = files.map((f) => f.path);
    const pathsChanged =
      currentPaths.length !== prevFilePathsRef.current.length ||
      currentPaths.some((p, i) => p !== prevFilePathsRef.current[i]);
    if (files.length > 0 && pathsChanged) {
      prevFilePathsRef.current = currentPaths;
      void loadAllFileHunksRef.current(files);
      setLargeChangesetExpandedRef.current(false);
    } else if (files.length === 0 && prevFilePathsRef.current.length > 0) {
      prevFilePathsRef.current = [];
      // Only clear uncommitted hunks. Committed Review-tab hunks are owned by
      // loadChangedFiles and must survive an empty working-copy file list
      // (e.g. right after committing every change while reviewing).
      setAllFileHunks(new Map());
      setLargeChangesetExpandedRef.current(false);
    }
  }, [files, setLargeChangesetExpandedRef]);

  return {
    files,
    setFiles,
    allFileHunks,
    setAllFileHunks,
    loadingAllHunks,
    initialLoading,
    committedFiles,
    committedFileHunks,
    setCommittedFiles,
    liveConflictedFiles,
    invalidateCache,
    refresh,
    loadChangedFiles,
    refreshCommittedChanges,
    loadAllFileHunks,
  };
}
