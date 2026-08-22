import { type KeyboardEvent as ReactKeyboardEvent, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, ListOrdered, Pencil, Trash2 } from "lucide-react";
import { type QueuedAgentMessage } from "../../lib/agentMessageQueue";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";

export interface AgentMessageQueueProps {
  messages: QueuedAgentMessage[];
  onEnqueue: (text: string) => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, text: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Terminal body element — dialog is centered inside this container. */
  overlayContainer?: HTMLElement | null;
  className?: string;
}

/**
 * Queue control for agent terminals — always lives in the agent toolbar.
 * Click opens a dialog centered in the terminal body (with a min bottom inset).
 * When non-empty the dialog lists queued messages (edit/remove). The follow-up
 * input is never shown outside the dialog. A count badge appears on the toolbar
 * button while messages wait.
 */
export function AgentMessageQueue({
  messages,
  onEnqueue,
  onRemove,
  onUpdate,
  open: openProp,
  onOpenChange,
  overlayContainer,
  className,
}: AgentMessageQueueProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;

  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const submitDraft = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onEnqueue(trimmed);
    setDraft("");
  };

  const handleComposerKeyDown = (
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitDraft();
    }
  };

  const startEdit = (message: QueuedAgentMessage) => {
    setEditingId(message.id);
    setEditDraft(message.text);
  };

  const commitEdit = () => {
    if (!editingId) return;
    onUpdate(editingId, editDraft);
    setEditingId(null);
    setEditDraft("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft("");
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setEditingId(null);
      setEditDraft("");
      setDraft("");
    }
  };

  const count = messages.length;
  const canSend = draft.trim().length > 0;

  const dialog = open ? (
    <div
      data-testid="agent-message-queue-dialog"
      data-position="terminal-center"
      className="absolute inset-0 z-30 flex items-center justify-center px-4 pb-10 pt-4"
    >
      <button
        type="button"
        aria-label="Dismiss queue dialog"
        className="absolute inset-0 bg-black/40"
        onClick={() => handleOpenChange(false)}
      />
      <div
        role="dialog"
        aria-label={count === 0 ? "Queue a follow-up" : "Queued messages"}
        className="relative z-10 w-[24rem] max-h-full space-y-2 overflow-y-auto rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg"
      >
        <Label className="px-0.5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
          {count === 0 ? "Queue a follow-up" : "Queued messages"}
        </Label>

        {count > 0 && (
          <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
            {messages.map((message, index) => {
              const isEditing = editingId === message.id;
              return (
                <li key={message.id}>
                  <Card
                    data-testid={`agent-message-queue-item-${message.id}`}
                    className="border-border/60 bg-muted/40 p-2.5 shadow-none"
                  >
                    {isEditing ? (
                      <div className="flex flex-col gap-2">
                        <Textarea
                          value={editDraft}
                          onChange={(event) => setEditDraft(event.target.value)}
                          data-testid={`agent-message-queue-edit-input-${message.id}`}
                          className="min-h-[72px] resize-y text-sm"
                          autoFocus
                        />
                        <div className="flex justify-end gap-1.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={cancelEdit}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            size="xs"
                            data-testid={`agent-message-queue-save-${message.id}`}
                            onClick={commitEdit}
                            disabled={!editDraft.trim()}
                          >
                            Save
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2">
                        <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm leading-snug text-foreground">
                          {message.text}
                        </p>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Edit queued message ${index + 1}`}
                            data-testid={`agent-message-queue-edit-${message.id}`}
                            className="text-muted-foreground"
                            onClick={() => startEdit(message)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Remove queued message ${index + 1}`}
                            data-testid={`agent-message-queue-remove-${message.id}`}
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() => onRemove(message.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}

        <Card className="gap-0 overflow-hidden border-input p-0 shadow-none focus-within:border-primary focus-within:ring-1 focus-within:ring-ring">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder="Add a follow-up..."
            data-testid="agent-message-queue-composer"
            className={cn(
              "min-h-[72px] resize-none border-0 bg-transparent px-3 py-2.5 text-sm shadow-none focus-visible:ring-0",
            )}
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-0.5">
            <span className="px-1 text-[10px] text-muted-foreground">
              Enter to queue · sends when idle
            </span>
            <Button
              type="button"
              size="icon-xs"
              aria-label="Add to queue"
              disabled={!canSend}
              onClick={submitDraft}
              className="h-7 w-7 rounded-full"
            >
              <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.5} />
            </Button>
          </div>
        </Card>
      </div>
    </div>
  ) : null;

  return (
    <div data-testid="agent-message-queue" className={className}>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        data-testid="agent-message-queue-button"
        aria-label={
          count > 0
            ? `${count} queued message${count === 1 ? "" : "s"}`
            : "Queue message"
        }
        title="Queue message"
        aria-expanded={open}
        className="relative bg-transparent text-gray-200 hover:bg-muted/20 hover:text-gray-200"
        onClick={() => handleOpenChange(!open)}
      >
        <ListOrdered className="h-4 w-4" />
        {count > 0 && (
          <span
            data-testid="agent-message-queue-count"
            className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold leading-none text-primary-foreground"
          >
            {count}
          </span>
        )}
      </Button>
      {dialog &&
        (overlayContainer ? createPortal(dialog, overlayContainer) : dialog)}
    </div>
  );
}
