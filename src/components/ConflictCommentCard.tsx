import { useState } from "react";
import { Textarea } from "./ui/textarea";
import { Button } from "./ui/button";

interface ConflictComment {
  id: string;
  conflictId: string;
  filePath: string;
  conflictNumber: number;
  text: string;
  createdAt: string;
}

interface ConflictCommentCardProps {
  conflictId: string;
  filePath: string;
  conflictNumber: number;
  startLine: number;
  endLine: number;
  comment?: ConflictComment;
  onSave: (text: string) => void;
  onClear: () => void;
}

export const ConflictCommentCard = ({
  filePath,
  startLine,
  endLine,
  comment,
  onSave,
  onClear,
}: ConflictCommentCardProps) => {
  const [text, setText] = useState(comment?.text || "");

  const handleSave = () => {
    onSave(text);
  };

  const handleCancel = () => {
    setText(comment?.text || "");
    onClear();
  };

  const lineLabel =
    startLine === endLine ? `L${startLine}` : `L${startLine}-${endLine}`;

  return (
    <div className="bg-muted/60 border-y border-border/40 px-4 py-3 font-sans text-base">
      <div className="mb-2 text-md text-muted-foreground">
        {filePath}:{lineLabel}
      </div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a comment..."
        className="mb-2 font-sans"
        autoFocus
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={handleCancel} size="sm">
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={!text.trim()} size="sm">
          Add Comment
        </Button>
      </div>
    </div>
  );
};

ConflictCommentCard.displayName = "ConflictCommentCard";
