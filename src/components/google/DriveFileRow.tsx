import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, FileText, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import type { DriveFile } from "../../lib/api-google";
import type { AgentReviewComment } from "../../lib/api-types-review";
import { Button } from "../ui/button";

/**
 * One Drive file: open it in Drive, review it, or open its review in the
 * document review viewer. Findings are read there first, so nothing reaches
 * the shared document without the user seeing it.
 */
export const DriveFileRow: React.FC<{
  file: DriveFile;
  /** Open findings for this file, fetched once for the whole panel. */
  findings: AgentReviewComment[];
  /** Refetches the panel's findings. */
  onFindingsChanged: () => Promise<unknown>;
  /** A review (of any file) is being prepared: its export may change. */
  disabled: boolean;
  onReview: (file: DriveFile) => Promise<void>;
  /** Opens the file in the document review viewer. */
  onOpenReview: (file: DriveFile) => void;
}> = ({
  file,
  findings,
  onFindingsChanged: mutate,
  disabled,
  onReview,
  onOpenReview,
}) => {
  /** The findings count the re-review confirmation was asked with. */
  const [confirmedCount, setConfirmedCount] = useState<number | null>(null);
  // The confirmation names a count; it lapses if that count changes.
  const confirmRerun = confirmedCount === findings.length;
  const setConfirmRerun = (on: boolean) =>
    setConfirmedCount(on ? findings.length : null);
  const [busy, setBusy] = useState(false);

  const review = async () => {
    // A new export replaces the old one, and unposted findings with it.
    if (findings.length > 0 && !confirmRerun) {
      setConfirmRerun(true);
      return;
    }
    setConfirmRerun(false);
    setBusy(true);
    try {
      await onReview(file);
      await mutate();
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="py-2" data-testid={`drive-file-${file.id}`}>
      <div className="flex items-center gap-3">
        <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{file.name}</p>
          <p className="text-xs text-muted-foreground truncate">
            {[
              file.owner,
              file.modified_time &&
                new Date(file.modified_time).toLocaleString(),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {file.web_view_link && (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Open ${file.name}`}
            onClick={() => void openUrl(file.web_view_link ?? "")}
          >
            <ExternalLink className="w-4 h-4" />
          </Button>
        )}
        {file.reviewable && (
          <Button variant="ghost" size="sm" onClick={() => onOpenReview(file)}>
            {findings.length > 0
              ? `${findings.length} finding${findings.length === 1 ? "" : "s"}`
              : "Open review"}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={!file.reviewable || disabled || busy}
          title={
            file.reviewable
              ? undefined
              : "Only Docs, Sheets, Slides and text files can be reviewed"
          }
          onClick={() => void review()}
        >
          {busy ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
          Review
        </Button>
      </div>

      {confirmRerun && (
        <div
          role="alert"
          className="ml-7 mt-2 flex items-center gap-2 text-sm text-muted-foreground"
        >
          A new review discards the {findings.length} unposted finding
          {findings.length === 1 ? "" : "s"}.
          <Button size="sm" variant="outline" onClick={() => void review()}>
            Review again
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setConfirmRerun(false)}
          >
            Cancel
          </Button>
        </div>
      )}
    </li>
  );
};
