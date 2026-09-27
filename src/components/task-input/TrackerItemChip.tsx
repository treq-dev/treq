import { CircleDot, X } from "lucide-react";
import type { TrackerItemAttachment } from "../../lib/promptAttachments";
import { TRACKER_PROVIDERS } from "../../lib/trackers";

export const TrackerItemChip: React.FC<{
  item: TrackerItemAttachment;
  onRemove: () => void;
}> = ({ item, onRemove }) => {
  const { label, itemNoun } = TRACKER_PROVIDERS[item.provider];
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 pt-3 pb-0">
      <span
        data-testid="tracker-item-chip"
        className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2 py-0.5 text-xs text-foreground"
        title={item.title}
      >
        <CircleDot className="h-3 w-3 text-sky-600 dark:text-sky-400" />
        <span className="font-medium">
          {label} {item.key}
        </span>
        <button
          type="button"
          aria-label={`Remove ${label} ${itemNoun}`}
          className="ml-0.5 rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={onRemove}
        >
          <X className="h-3 w-3" />
        </button>
      </span>
    </div>
  );
};
