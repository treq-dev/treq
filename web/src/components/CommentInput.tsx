import React, { memo, type KeyboardEvent as ReactKeyboardEvent, useCallback, useState } from 'react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';

export interface CommentInputProps {
  onSubmit: (text: string) => void;
  onCancel: () => void;
  filePath?: string;
  startLine?: number;
  endLine?: number;
}

export const CommentInput: React.FC<CommentInputProps> = memo(
  ({ onSubmit, onCancel, filePath, startLine, endLine }) => {
    const [text, setText] = useState('');

    const handleSubmit = useCallback(() => {
      if (text.trim()) onSubmit(text.trim());
    }, [text, onSubmit]);

    const handleKeyDown = useCallback(
      (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
        if (e.metaKey || e.ctrlKey) {
          const key = e.key.toLowerCase();
          if (['a', 'c', 'x', 'v', 'z', 'y'].includes(key)) {
            e.stopPropagation();
            return;
          }
        }
        if (e.key === 'Escape') onCancel();
        else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSubmit();
      },
      [onCancel, handleSubmit],
    );

    const lineLabel =
      startLine && endLine
        ? startLine === endLine
          ? `L${startLine}`
          : `L${startLine}–${endLine}`
        : null;

    return (
      <div className="bg-muted border border-border rounded-md mx-2 my-1 px-4 py-3 font-sans text-base">
        {filePath && lineLabel && (
          <div className="mb-2 text-sm text-muted-foreground font-mono">
            {filePath}:{lineLabel}
          </div>
        )}
        {!filePath && lineLabel && (
          <div className="mb-2 text-sm text-muted-foreground font-mono">{lineLabel}</div>
        )}
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a comment…"
          className="mb-2 font-sans min-h-[70px]"
          autoFocus
          onKeyDown={handleKeyDown}
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={!text.trim()}>
            Add Comment
          </Button>
        </div>
      </div>
    );
  },
);
CommentInput.displayName = 'CommentInput';
