import { Loader2, MessageCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { cn } from "../lib/utils";

// Type definitions - Git API removed, needs JJ equivalent
type DiffLineKind = "context" | "addition" | "deletion" | "meta";

export interface ReviewComment {
  id: string;
  filePath: string;
  lineKey: string;
  lineLabel: string;
  kind: DiffLineKind;
  oldLine?: number | null;
  newLine?: number | null;
  lineText: string;
  text: string;
  contextBefore: string[];
  contextAfter: string[];
  createdAt: string;
}

interface BranchDiffHunk {
  id: string;
  header: string;
  lines: Array<{
    kind: DiffLineKind;
    text: string;
    old_line?: number | null;
    new_line?: number | null;
  }>;
}

interface BranchDiffFileDiff {
  path: string;
  status: string;
  is_binary?: boolean;
  binary_message?: string;
  hunks?: BranchDiffHunk[];
  metadata?: string[];
}

export interface CommentInput {
  filePath: string;
  lineKey: string;
  lineLabel: string;
  kind: DiffLineKind;
  oldLine?: number | null;
  newLine?: number | null;
  lineText: string;
  text: string;
  contextBefore: string[];
  contextAfter: string[];
}

interface AnnotatableDiffViewerProps {
  diff?: BranchDiffFileDiff | null;
  comments: ReviewComment[];
  selectedCommentId?: string | null;
  isLoading?: boolean;
  onAddComment: (comment: CommentInput) => void;
  onSelectComment?: (commentId: string | null) => void;
}

interface DraftState {
  lineKey: string;
  lineLabel: string;
  kind: DiffLineKind;
  oldLine?: number | null;
  newLine?: number | null;
  lineText: string;
  contextBefore: string[];
  contextAfter: string[];
}

const lineKindStyles: Record<DiffLineKind, string> = {
  addition: "bg-green-500/10",
  context: "bg-transparent",
  deletion: "bg-red-500/10",
  meta: "bg-muted/40",
};

const lineKindPrefix: Record<DiffLineKind, string> = {
  addition: "+",
  context: " ",
  deletion: "-",
  meta: " ",
};

const formatLineLabel = (oldLine?: number | null, newLine?: number | null) => {
  if (typeof newLine === "number") {
    return `L${newLine}`;
  }
  if (typeof oldLine === "number") {
    return `L${oldLine}`;
  }
  return "Line";
};

const AnnotatableDiffViewerComponent: React.FC<AnnotatableDiffViewerProps> = ({
  diff,
  comments,
  selectedCommentId,
  isLoading = false,
  onAddComment,
  onSelectComment,
}) => {
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [draftText, setDraftText] = useState("");
  const hoverTargetRef = useRef<DraftState | null>(null);

  const fileComments = (() => {
    if (!diff) return [];
    return comments.filter((comment) => comment.filePath === diff.path);
  })();

  const commentCountByLine = (() => {
    const map = new Map<string, number>();
    fileComments.forEach((comment) => {
      map.set(comment.lineKey, (map.get(comment.lineKey) || 0) + 1);
    });
    return map;
  })();

  const handleStartDraft = (location: DraftState) => {
    setDraft(location);
    setDraftText("");
  };

  const cancelDraft = () => {
    setDraft(null);
    setDraftText("");
  };

  const handleSubmitDraft = () => {
    if (!draft || !draftText.trim()) {
      return;
    }

    onAddComment({
      contextAfter: draft.contextAfter,
      contextBefore: draft.contextBefore,
      filePath: diff?.path || "",
      kind: draft.kind,
      lineKey: draft.lineKey,
      lineLabel: draft.lineLabel,
      lineText: draft.lineText,
      newLine: draft.newLine,
      oldLine: draft.oldLine,
      text: draftText.trim(),
    });
    setDraft(null);
    setDraftText("");
  };

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      // Skip keyboard shortcuts when user is typing in an input field
      const target = event.target as HTMLElement;
      const isEditableElement =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (isEditableElement) {
        return;
      }

      if (
        event.key.toLowerCase() === "c" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        if (!draft && hoverTargetRef.current) {
          event.preventDefault();
          handleStartDraft(hoverTargetRef.current);
        }
      }

      if (event.key === "Escape" && draft) {
        event.preventDefault();
        cancelDraft();
      }
    };

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [draft, handleStartDraft, cancelDraft]);

  useEffect(() => {
    if (!diff || !selectedCommentId) return;
    const targetComment = fileComments.find(
      (comment) => comment.id === selectedCommentId,
    );
    if (!targetComment) return;
    const element = document.getElementById(`line-${targetComment.lineKey}`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      element.classList.add("ring", "ring-primary/40", "rounded-md");
      setTimeout(
        () => element.classList.remove("ring", "ring-primary/40"),
        1200,
      );
    }
  }, [diff, selectedCommentId, fileComments]);

  // Pre-compute context for all lines to avoid expensive buildContext calls on every render
  const linesWithContext = (() => {
    if (!diff) return [];

    const buildContext = (
      lines: BranchDiffHunk["lines"],
      index: number,
      radius: number,
    ) => {
      const before: string[] = [];
      const after: string[] = [];
      for (let offset = radius; offset > 0; offset -= 1) {
        const line = lines[index - offset];
        if (line) {
          before.push(`${lineKindPrefix[line.kind]}${line.text}`);
        }
      }
      for (let offset = 1; offset <= radius; offset += 1) {
        const line = lines[index + offset];
        if (line) {
          after.push(`${lineKindPrefix[line.kind]}${line.text}`);
        }
      }
      return { after, before };
    };

    if (!diff.hunks) return [];

    return diff.hunks.flatMap((hunk, hunkIndex) =>
      hunk.lines.map((line, lineIndex) => ({
        context: buildContext(hunk.lines, lineIndex, 3),
        hunkIndex,
        line,
        lineIndex,
      })),
    );
  })();

  const renderLineNumbers = (
    lineKey: string,
    lineNums: { newLine?: number | null; oldLine?: number | null },
    onClick?: () => void,
  ) => (
    <div className="flex flex-col items-center text-[11px] text-muted-foreground">
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left hover:text-foreground"
      >
        {typeof lineNums.oldLine === "number" ? lineNums.oldLine : ""}
      </button>
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left hover:text-foreground"
      >
        {typeof lineNums.newLine === "number" ? lineNums.newLine : ""}
      </button>
      {commentCountByLine.get(lineKey) && (
        <div className="flex items-center gap-1 text-[10px] text-primary">
          <MessageCircle className="w-3 h-3" />
          {commentCountByLine.get(lineKey)}
        </div>
      )}
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!diff) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        Select a file from the tree to start the review.
      </div>
    );
  }

  if (diff.is_binary) {
    return (
      <div className="p-6 text-sm">
        <p className="font-medium">Binary file</p>
        <p className="text-muted-foreground">
          {diff.binary_message || "Binary files differ"}
        </p>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      onMouseLeave={() => {
        hoverTargetRef.current = null;
      }}
    >
      <div className="border-b px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-mono">{diff.path}</p>
          <p className="text-sm text-muted-foreground">Status: {diff.status}</p>
        </div>
        {diff.metadata && diff.metadata.length > 0 && (
          <div className="text-[10px] text-muted-foreground text-right max-w-xs truncate">
            {diff.metadata.join(" · ")}
          </div>
        )}
      </div>
      <div className="flex-1 overflow-auto font-mono text-sm">
        {diff.hunks?.map((hunk, hunkIndex) => {
          const hunkLines = linesWithContext.filter(
            (item) => item.hunkIndex === hunkIndex,
          );
          return (
            <div
              key={`${diff.path}-hunk-${hunkIndex}`}
              className="border-b border-border/60"
            >
              <div className="bg-muted/60 px-4 py-1 text-[11px]">
                {hunk.header}
              </div>
              {hunkLines.map((item) => {
                const { line, lineIndex, context } = item;
                const lineKey = `${diff.path}:${hunkIndex}:${lineIndex}`;
                const lineLabel = formatLineLabel(line.old_line, line.new_line);
                const location: DraftState = {
                  contextAfter: context.after,
                  contextBefore: context.before,
                  kind: line.kind,
                  lineKey,
                  lineLabel,
                  lineText: line.text,
                  newLine: line.new_line,
                  oldLine: line.old_line,
                };

                return (
                  <div
                    key={lineKey}
                    id={`line-${lineKey}`}
                    className={cn(
                      "grid grid-cols-[70px_1fr] gap-3 px-4 py-1 border-b border-border/40",
                      lineKindStyles[line.kind],
                    )}
                    onMouseEnter={() => {
                      hoverTargetRef.current = location;
                    }}
                  >
                    {renderLineNumbers(
                      lineKey,
                      { newLine: line.new_line, oldLine: line.old_line },
                      () => handleStartDraft(location),
                    )}
                    <div className="space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <pre className="whitespace-pre-wrap leading-relaxed flex-1">
                          <span className="text-muted-foreground">
                            {lineKindPrefix[line.kind]}
                          </span>
                          {line.text || " "}
                        </pre>
                        {draft?.lineKey === lineKey ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            onClick={cancelDraft}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        ) : null}
                      </div>
                      {draft?.lineKey === lineKey && (
                        <div className="border rounded-md bg-background p-2 space-y-2">
                          <Textarea
                            placeholder="Add a comment"
                            value={draftText}
                            autoFocus
                            className="text-sm"
                            onChange={(event) =>
                              setDraftText(event.target.value)
                            }
                            onKeyDown={(event) => {
                              if (
                                (event.metaKey || event.ctrlKey) &&
                                event.key === "Enter"
                              ) {
                                event.preventDefault();
                                handleSubmitDraft();
                              }
                            }}
                          />
                          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                            <span>{draft.lineLabel}</span>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="secondary"
                                className="h-7 text-sm"
                                onClick={cancelDraft}
                              >
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                className="h-7 text-sm"
                                disabled={!draftText.trim()}
                                onClick={handleSubmitDraft}
                              >
                                Comment
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}

                      {fileComments
                        .filter((comment) => comment.lineKey === lineKey)
                        .map((comment) => (
                          <div
                            key={comment.id}
                            className={cn(
                              "border rounded-md bg-muted/60 p-2 text-[11px]",
                              selectedCommentId === comment.id &&
                                "ring-2 ring-primary/50",
                            )}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-medium">
                                {comment.lineLabel}
                              </span>
                              <button
                                type="button"
                                className="text-primary text-[10px]"
                                onClick={() => onSelectComment?.(comment.id)}
                              >
                                Jump
                              </button>
                            </div>
                            <p className="font-sans">{comment.text}</p>
                          </div>
                        ))}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const AnnotatableDiffViewer = AnnotatableDiffViewerComponent;
AnnotatableDiffViewer.displayName = "AnnotatableDiffViewer";
