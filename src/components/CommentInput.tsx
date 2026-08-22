import { type KeyboardEvent as ReactKeyboardEvent, useState } from "react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

export interface CommentInputProps {
  onSubmit: (text: string) => void;
  onCancel: () => void;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  /** When provided, shows "Plan" and "Edit" buttons instead of "Add Comment" */
  onSubmitWithMode?: (text: string, mode: "plan" | "acceptEdits") => void;
  /** When set, shows the quoted text being replied to (e.g. a GitHub review comment). */
  quote?: { text: string; author?: string };
  /** Controlled draft text. Survives remounts when the parent owns the value. */
  value?: string;
  onValueChange?: (text: string) => void;
}

export const CommentInput: React.FC<CommentInputProps> = ({
  onSubmit,
  onCancel,
  filePath,
  startLine,
  endLine,
  onSubmitWithMode,
  quote,
  value,
  onValueChange,
}) => {
  const [uncontrolledText, setUncontrolledText] = useState("");
  const isControlled = value !== undefined;
  const text = isControlled ? value : uncontrolledText;
  const setText = (next: string) => {
    if (isControlled) {
      onValueChange?.(next);
    } else {
      setUncontrolledText(next);
    }
  };

  const handleSubmit = () => {
    if (text.trim()) {
      onSubmit(text.trim());
    }
  };

  const handleSubmitMode = (mode: "plan" | "acceptEdits") => {
    if (text.trim() && onSubmitWithMode) {
      onSubmitWithMode(text.trim(), mode);
    }
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // Stop propagation for standard text editing shortcuts
    if (e.metaKey || e.ctrlKey) {
      const key = e.key.toLowerCase();
      if (["a", "c", "x", "v", "z", "y"].includes(key)) {
        e.stopPropagation();
        return; // Let browser handle natively
      }
    }

    if (e.key === "Escape") {
      onCancel();
    } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      if (onSubmitWithMode) {
        handleSubmitMode("acceptEdits");
      } else {
        handleSubmit();
      }
    }
  };

  const lineLabel =
    startLine && endLine
      ? startLine === endLine
        ? `L${startLine}`
        : `L${startLine}-${endLine}`
      : null;

  return (
    <div className="bg-muted border border-border rounded-md mx-2 my-1 px-4 py-3 font-sans text-base">
      {filePath && lineLabel && (
        <div className="mb-2 text-md text-muted-foreground">
          {filePath}:{lineLabel}
        </div>
      )}
      {quote && (
        <blockquote className="mb-2 border-l-2 border-sky-500/50 pl-3 text-sm text-muted-foreground italic">
          {quote.author && (
            <div className="not-italic font-medium">
              Quoting @{quote.author}
            </div>
          )}
          {quote.text}
        </blockquote>
      )}
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a comment..."
        className="mb-2 font-sans"
        autoFocus
        onKeyDown={handleKeyDown}
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {onSubmitWithMode ? (
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => handleSubmitMode("plan")}
              disabled={!text.trim()}
            >
              Plan
            </Button>
            <Button
              size="sm"
              onClick={() => handleSubmitMode("acceptEdits")}
              disabled={!text.trim()}
            >
              Edit
            </Button>
          </>
        ) : (
          <Button onClick={handleSubmit} disabled={!text.trim()}>
            Add Comment
          </Button>
        )}
      </div>
    </div>
  );
};
CommentInput.displayName = "CommentInput";
