import React, { useEffect, useRef, useState } from "react";
import type {
  DiffLinePointer,
  DiffLineSelection,
  FileHunksData,
  LineMouseDownPayload,
} from "../types";

interface UseLineSelectionParams {
  allFileHunks: Map<string, FileHunksData>;
  committedFileHunks?: Map<string, FileHunksData>;
  onClearFileSelections: () => void;
}

export function useLineSelection({
  allFileHunks,
  committedFileHunks,
  onClearFileSelections,
}: UseLineSelectionParams) {
  const [diffLineSelection, setDiffLineSelection] =
    useState<DiffLineSelection | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [, setCurrentDragLine] = useState<DiffLinePointer | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const isDraggingRef = useRef<boolean>(false);
  const isSelectingRef = useRef(false);
  const selectionAnchorRef = useRef<DiffLinePointer | null>(null);

  const clearSelection = () => {
    isSelectingRef.current = false;
    selectionAnchorRef.current = null;
    setDiffLineSelection(null);
    setContextMenuPosition(null);
  };

  const handleLineMouseDown = ({
    event,
    filePath,
    hunkIndex,
    lineIndex,
    lineContent,
    isStaged,
  }: LineMouseDownPayload) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    isDraggingRef.current = false;
    const anchor = { filePath, hunkIndex, lineIndex };
    isSelectingRef.current = true;
    selectionAnchorRef.current = anchor;
    setIsSelecting(true);
    setDiffLineSelection({
      filePath,
      lines: [{ hunkIndex, lineIndex, content: lineContent, isStaged }],
    });
    setCurrentDragLine(anchor);
    setContextMenuPosition(null);
  };

  const allFileHunksRef = useRef(allFileHunks);
  allFileHunksRef.current = allFileHunks;
  const committedFileHunksRef = useRef(committedFileHunks);
  committedFileHunksRef.current = committedFileHunks;
  const diffLineSelectionRef = useRef(diffLineSelection);
  diffLineSelectionRef.current = diffLineSelection;

  const handleLineMouseEnter = ({
    filePath,
    hunkIndex,
    lineIndex,
  }: DiffLinePointer) => {
    const selectionAnchor = selectionAnchorRef.current;
    if (
      !isSelectingRef.current ||
      !selectionAnchor ||
      selectionAnchor.filePath !== filePath
    )
      return;
    const working = allFileHunksRef.current.get(filePath);
    const committed = committedFileHunksRef.current?.get(filePath);
    let fileData = working ?? committed;
    const currentSelection = diffLineSelectionRef.current;
    // When the same path appears in both sections, pick the map whose
    // anchor line matches the content captured on mouseDown.
    if (working && committed && currentSelection?.lines.length) {
      const [anchorLine] = currentSelection.lines;
      const expected = anchorLine.content;
      const workingLine =
        working.hunks[selectionAnchor.hunkIndex]?.lines[
          selectionAnchor.lineIndex
        ];
      if (workingLine !== expected) {
        const committedLine =
          committed.hunks[selectionAnchor.hunkIndex]?.lines[
            selectionAnchor.lineIndex
          ];
        if (committedLine === expected) fileData = committed;
      }
    }
    if (!fileData) return;
    const newLines: DiffLineSelection["lines"] = [];
    const minHunk = Math.min(selectionAnchor.hunkIndex, hunkIndex);
    const maxHunk = Math.max(selectionAnchor.hunkIndex, hunkIndex);
    for (let h = minHunk; h <= maxHunk; h++) {
      const hunk = fileData.hunks[h];
      if (!hunk) continue;
      const startLine =
        h === minHunk
          ? selectionAnchor.hunkIndex === minHunk
            ? selectionAnchor.lineIndex
            : 0
          : 0;
      const endLine =
        h === maxHunk
          ? hunkIndex === maxHunk
            ? lineIndex
            : hunk.lines.length - 1
          : hunk.lines.length - 1;
      const actualStart = Math.min(startLine, endLine);
      const actualEnd = Math.max(startLine, endLine);
      for (let l = actualStart; l <= actualEnd; l++) {
        const line = hunk.lines[l];
        if (line)
          newLines.push({
            hunkIndex: h,
            lineIndex: l,
            content: line,
            isStaged: false,
          });
      }
    }
    if (
      selectionAnchor.hunkIndex !== hunkIndex ||
      selectionAnchor.lineIndex !== lineIndex
    )
      isDraggingRef.current = true;
    setDiffLineSelection({ filePath, lines: newLines });
    setCurrentDragLine({ filePath, hunkIndex, lineIndex });
  };

  const handleLineMouseUp = () => {
    isSelectingRef.current = false;
    setIsSelecting(false);
  };

  const handleBackgroundClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest(".group\\/row")) return;
    if (
      target.closest(
        "button, [role='button'], input, textarea, [role='checkbox'], [role='menuitem']",
      )
    )
      return;
    onClearFileSelections();
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (diffLineSelection && diffLineSelection.lines.length > 0) {
      e.preventDefault();
      setContextMenuPosition({ x: e.clientX, y: e.clientY });
    }
  };

  const isLineSelected = ({
    filePath,
    hunkIndex,
    lineIndex,
  }: DiffLinePointer) => {
    if (!diffLineSelection || diffLineSelection.filePath !== filePath)
      return false;
    return diffLineSelection.lines.some(
      (l) => l.hunkIndex === hunkIndex && l.lineIndex === lineIndex,
    );
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContextMenuPosition(null);
        setDiffLineSelection(null);
        setCurrentDragLine(null);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const handleClickOutside = () => {
      setContextMenuPosition(null);
    };
    if (contextMenuPosition) {
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
    }
  }, [contextMenuPosition]);

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      isSelectingRef.current = false;
      if (isSelecting) setIsSelecting(false);
    };
    document.addEventListener("mouseup", handleGlobalMouseUp);
    return () => document.removeEventListener("mouseup", handleGlobalMouseUp);
  }, [isSelecting]);

  return {
    diffLineSelection,
    setDiffLineSelection,
    contextMenuPosition,
    setContextMenuPosition,
    clearSelection,
    handleLineMouseDown,
    handleLineMouseEnter,
    handleLineMouseUp,
    handleBackgroundClick,
    handleContextMenu,
    isLineSelected,
  };
}
