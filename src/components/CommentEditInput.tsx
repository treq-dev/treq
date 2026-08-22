import {
  type KeyboardEvent as ReactKeyboardEvent,
  useRef,
  useState,
} from "react";
import { Textarea } from "./ui/textarea";
import { Button } from "./ui/button";

interface CommentEditInputProps {
  initialText: string;
  onSave: (text: string) => void;
  onCancel: () => void;
  onDiscard: () => void;
}

export const CommentEditInput: React.FC<CommentEditInputProps> = ({
  initialText,
  onSave,
  onCancel,
  onDiscard,
}) => {
  const [text, setText] = useState(initialText);
  const textRef = useRef(text);
  textRef.current = text;

  const handleSave = () => {
    const next = textRef.current.trim();
    if (next) {
      onSave(next);
    }
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.metaKey || e.ctrlKey) {
      const key = e.key.toLowerCase();
      if (["a", "c", "x", "v", "z", "y"].includes(key)) {
        e.stopPropagation();
        return;
      }
    }

    if (e.key === "Escape") {
      onCancel();
    } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <div className="space-y-2">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="font-sans text-sm"
        autoFocus
        onKeyDown={handleKeyDown}
      />
      <div className="flex justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onDiscard}
          className="text-destructive hover:text-destructive hover:bg-destructive/10 font-sans"
        >
          Discard
        </Button>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="font-sans"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!text.trim()}
            className="font-sans"
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
};

CommentEditInput.displayName = "CommentEditInput";
