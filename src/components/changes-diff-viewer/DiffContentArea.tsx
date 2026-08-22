import React, { useLayoutEffect, useRef } from "react";
import { CheckCircle2, FileText, Loader2 } from "lucide-react";
import type { VirtuosoHandle } from "react-virtuoso";
import type {
  ConflictRegion,
  GhReviewThread,
  JjFileChange,
} from "../../lib/api";
import type { ParsedFileChange } from "../../lib/git-utils";
import { Button } from "../ui/button";
import { SearchOverlay } from "../SearchOverlay";
import type { DiffVirtuosoIndexMaps } from "./buildDiffVirtuosoItems";
import { DiffVirtuosoList } from "./DiffVirtuoso";
import type {
  CommentLineQuery,
  ConflictComment,
  DiffLinePointer,
  DiffLineSelection,
  DiffSearchData,
  FileHunksData,
  LineComment,
  LineMouseDownPayload,
  PendingComment,
} from "./types";
import type { useToast } from "../ui/toast";
import { filterVisibleCommittedFiles } from "./utils";

export interface DiffContentAreaProps {
  // search
  isSearchOpen: boolean;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  currentMatchIndex: number;
  setCurrentMatchIndex: React.Dispatch<React.SetStateAction<number>>;
  handleSearchNext: () => void;
  handleSearchPrevious: () => void;
  handleSearchClose: () => void;
  searchFocusTrigger: number;
  searchData: DiffSearchData;
  debouncedSearchQuery: string;
  // loading / data
  initialLoading: boolean;
  loadingAllHunks: boolean;
  files: ParsedFileChange[];
  allFileHunks: Map<string, FileHunksData>;
  committedFileHunks: Map<string, FileHunksData>;
  committedFiles: JjFileChange[];
  showCommittedChanges: boolean | undefined;
  // large changeset
  largeChangesetExpanded: boolean;
  setLargeChangesetExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  // conflicts
  actualConflictedFiles: string[];
  conflictLineLookups: Map<string, Map<number, ConflictRegion>>;
  firstConflictRegionIdByFile: Map<string, string>;
  // comment / selection props forwarded to HunkLines
  expandedContext: Map<string, string[]>;
  conflictComments: Map<string, ConflictComment>;
  openConflictComments: Set<string>;
  editingConflictCommentId: string | null;
  diffLineSelection: DiffLineSelection | null;
  showCommentInput: boolean;
  pendingComment: PendingComment | null;
  editingCommentId: string | null;
  comments: LineComment[];
  conflictFileRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  diffFontSize: number;
  handleExpandContext: (
    filePath: string,
    hunkIndex: number,
    direction: "before" | "after",
  ) => void;
  handleLineMouseDown: (payload: LineMouseDownPayload) => void;
  handleLineMouseEnter: (line: DiffLinePointer) => void;
  handleLineMouseUp: () => void;
  handleAddCommentFromSelection: () => void;
  isLineSelected: (line: DiffLinePointer) => boolean;
  saveConflictComment: (args: {
    conflictId: string;
    filePath: string;
    conflictNumber: number;
    text: string;
  }) => void;
  clearConflictComment: (conflictId: string) => void;
  toggleConflictComment: (conflictId: string) => void;
  setOpenConflictComments: React.Dispatch<React.SetStateAction<Set<string>>>;
  startEditConflictComment: (commentId: string) => void;
  cancelEditConflictComment: () => void;
  saveEditConflictComment: (commentId: string, text: string) => void;
  addComment: (text: string) => void;
  cancelComment: () => void;
  deleteComment: (commentId: string) => void;
  startEditComment: (commentId: string) => void;
  cancelEditComment: () => void;
  saveEditComment: (commentId: string, text: string) => void;
  setPendingComment: React.Dispatch<
    React.SetStateAction<PendingComment | null>
  >;
  setShowCommentInput: React.Dispatch<React.SetStateAction<boolean>>;
  getCommentsForLine: (query: CommentLineQuery) => LineComment[];
  getThreadsForLine: (query: CommentLineQuery) => GhReviewThread[];
  getUnplacedThreadsForFile: (filePath: string) => GhReviewThread[];
  collapsedThreadIds: Set<string>;
  toggleThreadCollapse: (threadId: string) => void;
  // file row props
  collapsedFiles: Set<string>;
  viewedFiles: Map<string, { viewedAt: string; contentHash: string }>;
  expandedLargeDiffs: Set<string>;
  readOnly: boolean;
  fileActionTarget: string | null;
  selectedUnstagedFiles: Set<string>;
  workspacePath: string;
  toggleFileCollapse: (filePath: string) => void;
  toggleLargeDiff: (filePath: string) => void;
  handleMarkFileViewed: (filePath: string) => void;
  handleUnmarkFileViewed: (filePath: string) => void;
  handleDiscardFiles: (filePath: string) => void;
  handleContextMenu: (e: React.MouseEvent) => void;
  addToast: ReturnType<typeof useToast>["addToast"];
  getOutdatedCommentsForFile: (filePath: string) => LineComment[];
  getFileCommentsForFile: (filePath: string) => LineComment[];
  diffContainerRef: React.RefObject<HTMLDivElement | null>;
  diffScrollApiRef: React.MutableRefObject<{
    scrollToFile: (path: string) => void;
    scrollToSearchId: (id: string) => void;
  } | null>;
}

export function DiffContentArea({
  isSearchOpen,
  searchQuery,
  setSearchQuery,
  currentMatchIndex,
  setCurrentMatchIndex,
  handleSearchNext,
  handleSearchPrevious,
  handleSearchClose,
  searchFocusTrigger,
  searchData,
  debouncedSearchQuery,
  initialLoading,
  loadingAllHunks,
  files,
  allFileHunks,
  committedFileHunks,
  committedFiles,
  showCommittedChanges,
  largeChangesetExpanded,
  setLargeChangesetExpanded,
  actualConflictedFiles,
  conflictLineLookups,
  firstConflictRegionIdByFile,
  expandedContext,
  conflictComments,
  openConflictComments,
  editingConflictCommentId,
  diffLineSelection,
  showCommentInput,
  pendingComment,
  editingCommentId,
  comments,
  conflictFileRefs,
  diffFontSize,
  handleExpandContext,
  handleLineMouseDown,
  handleLineMouseEnter,
  handleLineMouseUp,
  handleAddCommentFromSelection,
  isLineSelected,
  saveConflictComment,
  clearConflictComment,
  toggleConflictComment,
  setOpenConflictComments,
  startEditConflictComment,
  cancelEditConflictComment,
  saveEditConflictComment,
  addComment,
  cancelComment,
  deleteComment,
  startEditComment,
  cancelEditComment,
  saveEditComment,
  setPendingComment,
  setShowCommentInput,
  getCommentsForLine,
  getThreadsForLine,
  getUnplacedThreadsForFile,
  collapsedThreadIds,
  toggleThreadCollapse,
  collapsedFiles,
  viewedFiles,
  expandedLargeDiffs,
  readOnly,
  fileActionTarget,
  selectedUnstagedFiles,
  workspacePath,
  toggleFileCollapse,
  toggleLargeDiff,
  handleMarkFileViewed,
  handleUnmarkFileViewed,
  handleDiscardFiles,
  handleContextMenu,
  addToast,
  getOutdatedCommentsForFile,
  getFileCommentsForFile,
  diffContainerRef,
  diffScrollApiRef,
}: DiffContentAreaProps) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const indexMapsRef = useRef<DiffVirtuosoIndexMaps>({
    filePathToIndex: new Map(),
    searchIdToIndex: new Map(),
  });

  useLayoutEffect(() => {
    diffScrollApiRef.current = {
      scrollToFile: (filePath) => {
        const index = indexMapsRef.current.filePathToIndex.get(filePath);
        if (index !== undefined) {
          virtuosoRef.current?.scrollToIndex({
            index,
            align: "start",
            behavior: "smooth",
          });
        }
        const fileId = `file-section-${filePath.replace(/[^a-zA-Z0-9]/g, "-")}`;
        document.getElementById(fileId)?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      },
      scrollToSearchId: (searchId) => {
        const index = indexMapsRef.current.searchIdToIndex.get(searchId);
        if (index !== undefined) {
          virtuosoRef.current?.scrollToIndex({
            index,
            align: "center",
            behavior: "smooth",
          });
        }
        const el = diffContainerRef.current?.querySelector(
          `[data-search-id="${CSS.escape(searchId)}"]`,
        );
        if (el instanceof HTMLElement) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      },
    };
    return () => {
      diffScrollApiRef.current = null;
    };
  }, [diffScrollApiRef]);

  const alwaysVisibleCommittedPaths = (() => {
    const paths = new Set<string>(actualConflictedFiles);
    for (const file of files) paths.add(file.path);
    return paths;
  })();

  const visibleCommittedFiles = filterVisibleCommittedFiles(
    committedFiles,
    showCommittedChanges ?? false,
    alwaysVisibleCommittedPaths,
  );

  return (
    <div className="flex-1 overflow-hidden relative">
      <SearchOverlay
        isVisible={isSearchOpen}
        query={searchQuery}
        onQueryChange={(q) => {
          setSearchQuery(q);
          setCurrentMatchIndex(0);
        }}
        onNext={handleSearchNext}
        onPrevious={handleSearchPrevious}
        onClose={handleSearchClose}
        currentMatch={searchData.matches.length > 0 ? currentMatchIndex + 1 : 0}
        totalMatches={searchData.matches.length}
        className="absolute top-2 right-2 z-20"
        focusTrigger={searchFocusTrigger}
      />
      {initialLoading ? (
        <div className="h-full flex items-center justify-center text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span className="ml-2">Loading diffs...</span>
        </div>
      ) : files.length === 0 && visibleCommittedFiles.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
          <CheckCircle2 className="w-12 h-12 mb-3 text-muted-foreground/40" />
          <p className="text-sm">No changes to review</p>
        </div>
      ) : (
        (() => {
          let totalLines = 0;
          for (const [, fileData] of allFileHunks) {
            if (!fileData.isLoading && fileData.hunks) {
              for (const hunk of fileData.hunks)
                totalLines += hunk.lines.length;
            }
          }
          if (totalLines > 1000 && !largeChangesetExpanded) {
            return (
              <div className="h-full flex flex-col items-center justify-center gap-4 text-muted-foreground">
                <FileText className="w-12 h-12 opacity-50" />
                <div className="text-center">
                  <p className="font-medium mb-1">Large changeset</p>
                  <p className="text-sm">
                    {totalLines} lines across {files.length} file
                    {files.length !== 1 ? "s" : ""}
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => setLargeChangesetExpanded(true)}
                >
                  View changes
                </Button>
              </div>
            );
          }
          return (
            <div className="h-full px-4">
              <DiffVirtuosoList
                props={{
                  isSearchOpen,
                  searchQuery,
                  setSearchQuery,
                  currentMatchIndex,
                  setCurrentMatchIndex,
                  handleSearchNext,
                  handleSearchPrevious,
                  handleSearchClose,
                  searchFocusTrigger,
                  searchData,
                  debouncedSearchQuery,
                  initialLoading,
                  loadingAllHunks,
                  files,
                  allFileHunks,
                  committedFileHunks,
                  committedFiles,
                  showCommittedChanges,
                  largeChangesetExpanded,
                  setLargeChangesetExpanded,
                  actualConflictedFiles,
                  conflictLineLookups,
                  firstConflictRegionIdByFile,
                  expandedContext,
                  conflictComments,
                  openConflictComments,
                  editingConflictCommentId,
                  diffLineSelection,
                  showCommentInput,
                  pendingComment,
                  editingCommentId,
                  comments,
                  conflictFileRefs,
                  diffFontSize,
                  handleExpandContext,
                  handleLineMouseDown,
                  handleLineMouseEnter,
                  handleLineMouseUp,
                  handleAddCommentFromSelection,
                  isLineSelected,
                  saveConflictComment,
                  clearConflictComment,
                  toggleConflictComment,
                  setOpenConflictComments,
                  startEditConflictComment,
                  cancelEditConflictComment,
                  saveEditConflictComment,
                  addComment,
                  cancelComment,
                  deleteComment,
                  startEditComment,
                  cancelEditComment,
                  saveEditComment,
                  setPendingComment,
                  setShowCommentInput,
                  getCommentsForLine,
                  getThreadsForLine,
                  getUnplacedThreadsForFile,
                  collapsedThreadIds,
                  toggleThreadCollapse,
                  collapsedFiles,
                  viewedFiles,
                  expandedLargeDiffs,
                  readOnly,
                  fileActionTarget,
                  selectedUnstagedFiles,
                  workspacePath,
                  toggleFileCollapse,
                  toggleLargeDiff,
                  handleMarkFileViewed,
                  handleUnmarkFileViewed,
                  handleDiscardFiles,
                  handleContextMenu,
                  addToast,
                  getOutdatedCommentsForFile,
                  getFileCommentsForFile,
                  diffContainerRef,
                  diffScrollApiRef,
                }}
                virtuosoRef={virtuosoRef}
                indexMapsRef={indexMapsRef}
                scrollerRef={diffContainerRef}
              />
            </div>
          );
        })()
      )}
    </div>
  );
}
