import React, { useMemo } from "react";
import type { DiffContentAreaProps } from "./DiffContentArea";
import {
  DiffRenderContext,
  type DiffRenderContextValue,
} from "./DiffVirtuosoContext";
import { DiffVirtuosoRow } from "./DiffVirtuosoRow";
import { committedFileToParsed } from "./buildDiffVirtuosoItems";
import { useDiffVirtuosoItems } from "./useDiffVirtuosoItems";
import { filterVisibleCommittedFiles } from "./utils";

export function DiffVirtuosoList({
  props,
  scrollerRef,
}: {
  props: DiffContentAreaProps;
  scrollerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const visibleCommittedFiles = useMemo(() => {
    const paths = new Set<string>(props.actualConflictedFiles);
    for (const file of props.files) paths.add(file.path);
    return filterVisibleCommittedFiles(
      props.committedFiles,
      props.showCommittedChanges ?? false,
      paths,
    ).map(committedFileToParsed);
  }, [
    props.actualConflictedFiles,
    props.files,
    props.committedFiles,
    props.showCommittedChanges,
  ]);

  const { items } = useDiffVirtuosoItems({
    actualConflictedFiles: props.actualConflictedFiles,
    allFileHunks: props.allFileHunks,
    collapsedFiles: props.collapsedFiles,
    committedFileHunks: props.committedFileHunks,
    committedFiles: visibleCommittedFiles,
    conflictLineLookups: props.conflictLineLookups,
    expandedContext: props.expandedContext,
    expandedLargeDiffs: props.expandedLargeDiffs,
    files: props.files,
    getFileCommentsForFile: props.getFileCommentsForFile,
    getOutdatedCommentsForFile: props.getOutdatedCommentsForFile,
    getUnplacedThreadsForFile: props.getUnplacedThreadsForFile,
    pendingComment: props.pendingComment,
    showCommentInput: props.showCommentInput,
    viewedFiles: props.viewedFiles,
  });

  const hunkLinesProps = {
    conflictedFilePaths: new Set(props.actualConflictedFiles),
    conflictLineLookups: props.conflictLineLookups,
    firstConflictRegionIdByFile: props.firstConflictRegionIdByFile,
    expandedContext: props.expandedContext,
    conflictComments: props.conflictComments,
    openConflictComments: props.openConflictComments,
    editingConflictCommentId: props.editingConflictCommentId,
    searchData: props.searchData,
    debouncedSearchQuery: props.debouncedSearchQuery,
    currentMatchIndex: props.currentMatchIndex,
    diffLineSelection: props.diffLineSelection,
    showCommentInput: props.showCommentInput,
    pendingComment: props.pendingComment,
    editingCommentId: props.editingCommentId,
    comments: props.comments,
    conflictFileRefs: props.conflictFileRefs,
    diffFontSize: props.diffFontSize,
    handleExpandContext: props.handleExpandContext,
    handleLineMouseDown: props.handleLineMouseDown,
    handleLineMouseEnter: props.handleLineMouseEnter,
    handleLineMouseUp: props.handleLineMouseUp,
    handleAddCommentFromSelection: props.handleAddCommentFromSelection,
    isLineSelected: props.isLineSelected,
    saveConflictComment: props.saveConflictComment,
    clearConflictComment: props.clearConflictComment,
    toggleConflictComment: props.toggleConflictComment,
    setOpenConflictComments: props.setOpenConflictComments,
    startEditConflictComment: props.startEditConflictComment,
    cancelEditConflictComment: props.cancelEditConflictComment,
    saveEditConflictComment: props.saveEditConflictComment,
    addComment: props.addComment,
    cancelComment: props.cancelComment,
    deleteComment: props.deleteComment,
    startEditComment: props.startEditComment,
    cancelEditComment: props.cancelEditComment,
    saveEditComment: props.saveEditComment,
    setPendingComment: props.setPendingComment,
    setShowCommentInput: props.setShowCommentInput,
    getCommentsForLine: props.getCommentsForLine,
    getThreadsForLine: props.getThreadsForLine,
    collapsedThreadIds: props.collapsedThreadIds,
    toggleThreadCollapse: props.toggleThreadCollapse,
  };

  const contextValue: DiffRenderContextValue = { ...props, hunkLinesProps };

  return (
    <DiffRenderContext.Provider value={contextValue}>
      <div ref={scrollerRef} className="h-full overflow-auto pb-32">
        {items.map((item) => (
          <DiffVirtuosoRow key={item.key} item={item} />
        ))}
      </div>
    </DiffRenderContext.Provider>
  );
}
