import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  Loader2,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { deleteAgentReviewComment } from "../../lib/api";
import { googlePostReviewComments, type DriveFile } from "../../lib/api-google";
import type { AgentReviewComment } from "../../lib/api-types-review";
import { errorText } from "../../lib/errorText";
import { isNotFoundError } from "../../lib/google-tasks";
import { useToastStore } from "../../stores/toastStore";
import { Button } from "../ui/button";

/**
 * One Drive file: open it, review it, and read, drop or post the review's
 * findings. Findings are shown here first so nothing reaches the shared
 * document without the user seeing it.
 */
export const DriveFileRow: React.FC<{
  file: DriveFile;
  repoPath: string;
  /** Open findings for this file, fetched once for the whole panel. */
  findings: AgentReviewComment[];
  /** Refetches the panel's findings. */
  onFindingsChanged: () => Promise<unknown>;
  /** A review (of any file) is being prepared: its export may change. */
  disabled: boolean;
  onReview: (file: DriveFile) => Promise<void>;
}> = ({
  file,
  repoPath,
  findings,
  onFindingsChanged: mutate,
  disabled,
  onReview,
}) => {
  const { addToast } = useToastStore();
  const [expanded, setExpanded] = useState(false);
  /** The findings count the re-review confirmation was asked with. */
  const [confirmedCount, setConfirmedCount] = useState<number | null>(null);
  // The confirmation names a count; it lapses if that count changes.
  const confirmRerun = confirmedCount === findings.length;
  const setConfirmRerun = (on: boolean) =>
    setConfirmedCount(on ? findings.length : null);
  const [busy, setBusy] = useState<"review" | "post" | null>(null);
  /** Findings with a drop in flight. */
  const [dropping, setDropping] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const review = async () => {
    // A new export replaces the old one, and unposted findings with it.
    if (findings.length > 0 && !confirmRerun) {
      setConfirmRerun(true);
      return;
    }
    setConfirmRerun(false);
    setBusy("review");
    try {
      await onReview(file);
      await mutate();
    } finally {
      setBusy(null);
    }
  };

  const post = async () => {
    setBusy("post");
    try {
      const { posted, errors } = await googlePostReviewComments(
        repoPath,
        file.id,
      );
      if (errors.length > 0) {
        addToast({
          title: `Posted ${posted}, ${errors.length} failed`,
          description: `${errors[0]} Failed findings stay listed; post again to retry.`,
          type: "warning",
        });
      } else {
        addToast({
          title: `Posted ${posted} comment${posted === 1 ? "" : "s"}`,
          description: file.name,
          type: "success",
        });
      }
    } catch (e) {
      addToast({
        title: "Failed to post comments",
        description: errorText(e),
        type: "error",
      });
    } finally {
      await mutate();
      setBusy(null);
    }
  };

  const drop = async (id: string) => {
    if (dropping.has(id)) return;
    setDropping((prev) => new Set(prev).add(id));
    try {
      await deleteAgentReviewComment(repoPath, id);
    } catch (e) {
      // Already gone (posted or dropped elsewhere): nothing left to do.
      if (!isNotFoundError(e))
        addToast({
          title: "Failed to remove finding",
          description: errorText(e),
          type: "error",
        });
    }
    await mutate();
    setDropping((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
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
        {findings.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
            {findings.length} finding{findings.length === 1 ? "" : "s"}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={!file.reviewable || disabled || busy !== null}
          title={
            file.reviewable
              ? undefined
              : "Only Docs, Sheets, Slides and text files can be reviewed"
          }
          onClick={() => void review()}
        >
          {busy === "review" ? (
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

      {expanded && findings.length > 0 && (
        <div className="ml-7 mt-2 space-y-2">
          <ul className="space-y-2">
            {findings.map((finding) => (
              <li
                key={finding.id}
                className="rounded-md border border-border p-2 text-sm"
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-muted-foreground">
                      Lines {finding.start_line}–{finding.end_line}
                    </p>
                    <p className="whitespace-pre-wrap break-words">
                      {finding.comment_text}
                    </p>
                    {finding.suggested_replacement && (
                      <p className="mt-1 text-xs whitespace-pre-wrap break-words text-muted-foreground">
                        Suggested: {finding.suggested_replacement}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Drop finding"
                    disabled={
                      disabled || busy !== null || dropping.has(finding.id)
                    }
                    onClick={() => void drop(finding.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            disabled={disabled || busy !== null || dropping.size > 0}
            onClick={() => void post()}
          >
            {busy === "post" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            Post {findings.length} comment{findings.length === 1 ? "" : "s"} to
            Drive
          </Button>
        </div>
      )}
    </li>
  );
};
