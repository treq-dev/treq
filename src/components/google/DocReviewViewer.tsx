import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowLeft,
  ExternalLink,
  FileText,
  Loader2,
  Send,
  Sparkles,
} from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import useSWR from "swr";
import {
  deleteAgentReviewComment,
  resolveAgentReviewComment,
} from "../../lib/api";
import {
  type DriveFile,
  googlePostReviewComments,
  googleReadDocExport,
} from "../../lib/api-google";
import type { AgentReviewComment } from "../../lib/api-types-review";
import { errorText } from "../../lib/errorText";
import { isNotFoundError } from "../../lib/google-tasks";
import { useToastStore } from "../../stores/toastStore";
import { AgentReviewCommentCard } from "../changes-diff-viewer/AgentReviewCommentCard";
import { Button } from "../ui/button";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Findings grouped by the export line they render after: each one's end line,
 * clamped into the document so a stale range still shows up at the end.
 */
export function placeFindings(
  findings: AgentReviewComment[],
  lineCount: number,
): Map<number, AgentReviewComment[]> {
  const byLine = new Map<number, AgentReviewComment[]>();
  const sorted = [...findings].sort(
    (a, b) => a.end_line - b.end_line || a.start_line - b.start_line,
  );
  for (const finding of sorted) {
    const line = Math.min(
      Math.max(finding.end_line, 1),
      Math.max(lineCount, 1),
    );
    const list = byLine.get(line) ?? [];
    list.push(finding);
    byLine.set(line, list);
  }
  return byLine;
}

/**
 * The review of one Drive file, laid out like the code review viewer: the
 * exported text with line numbers, each agent finding inline after the lines
 * it covers, and header actions to post the findings to Drive or re-review.
 */
export const DocReviewViewer: React.FC<{
  file: DriveFile;
  repoPath: string;
  /** Open findings for this file. */
  findings: AgentReviewComment[];
  onFindingsChanged: () => Promise<unknown>;
  /** A review (of any file) is being prepared: its export may change. */
  reviewDisabled: boolean;
  onReview: (file: DriveFile) => Promise<void>;
  onClose: () => void;
}> = ({
  file,
  repoPath,
  findings,
  onFindingsChanged,
  reviewDisabled,
  onReview,
  onClose,
}) => {
  const { addToast } = useToastStore();
  const [busy, setBusy] = useState<"review" | "post" | null>(null);
  /** The findings count the re-review confirmation was asked with. */
  const [confirmedCount, setConfirmedCount] = useState<number | null>(null);
  const confirmRerun = confirmedCount === findings.length;

  const {
    data: exported,
    error: exportError,
    isLoading,
    mutate: refetchExport,
  } = useSWR(
    ["google-doc-export", repoPath, file.id],
    () => googleReadDocExport(repoPath, file.id),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const lines = useMemo(
    () => (exported ? exported.text.replace(/\n$/, "").split("\n") : []),
    [exported],
  );
  const placed = useMemo(
    () => placeFindings(findings, lines.length),
    [findings, lines.length],
  );

  const review = async () => {
    // A new export replaces the old one, and unposted findings with it.
    if (findings.length > 0 && !confirmRerun) {
      setConfirmedCount(findings.length);
      return;
    }
    setConfirmedCount(null);
    setBusy("review");
    try {
      await onReview(file);
      await Promise.all([onFindingsChanged(), refetchExport()]);
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
          title: `Posted ${plural(posted, "comment")}`,
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
      await onFindingsChanged();
      setBusy(null);
    }
  };

  /** Resolve or drop a finding; one already gone counts as done. */
  const settle = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (e) {
      if (!isNotFoundError(e)) throw e;
    } finally {
      await onFindingsChanged();
    }
  };

  const originalText = (finding: AgentReviewComment) => {
    if (finding.start_line < 1 || finding.end_line > lines.length) {
      return undefined;
    }
    return lines.slice(finding.start_line - 1, finding.end_line).join("\n");
  };

  const renderFindings = (list: AgentReviewComment[]) => (
    <div
      data-testid="agent-review-inline-list"
      className="border-y border-violet-500/30 bg-violet-500/[0.03] px-[16px] py-[8px] space-y-2 font-sans"
    >
      {list.map((finding) => (
        <AgentReviewCommentCard
          key={finding.id}
          comment={{ ...finding, file_path: file.name }}
          originalText={originalText(finding)}
          onResolve={(id) =>
            settle(() => resolveAgentReviewComment(repoPath, id))
          }
          onDelete={(id) =>
            settle(() => deleteAgentReviewComment(repoPath, id))
          }
          onError={(message) =>
            addToast({
              title: "Failed to update finding",
              description: message,
              type: "error",
            })
          }
        />
      ))}
    </div>
  );

  const busyAny = busy !== null;

  return (
    <div
      className="flex flex-col h-full min-h-0"
      data-testid="doc-review-viewer"
    >
      <div className="flex items-center gap-2 px-4 pb-2 border-b border-border">
        <Button
          variant="ghost"
          size="sm"
          aria-label="Back to files"
          onClick={onClose}
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{file.name}</p>
          <p className="text-xs text-muted-foreground">
            {findings.length > 0
              ? `${plural(findings.length, "unposted finding")}`
              : "No open findings"}
          </p>
        </div>
        {file.web_view_link && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void openUrl(file.web_view_link ?? "")}
          >
            <ExternalLink className="w-4 h-4" />
            Open in Drive
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={!file.reviewable || reviewDisabled || busyAny}
          onClick={() => void review()}
        >
          {busy === "review" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
          {exported || findings.length > 0 ? "Re-review" : "Review"}
        </Button>
        <Button
          size="sm"
          disabled={findings.length === 0 || reviewDisabled || busyAny}
          onClick={() => void post()}
        >
          {busy === "post" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
          Post {plural(findings.length, "comment")} to Drive
        </Button>
      </div>

      {confirmRerun && (
        <div
          role="alert"
          className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground border-b border-border"
        >
          A new review discards the{" "}
          {plural(findings.length, "unposted finding")}.
          <Button size="sm" variant="outline" onClick={() => void review()}>
            Review again
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setConfirmedCount(null)}
          >
            Cancel
          </Button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center gap-2 p-4 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading document…
          </div>
        ) : exportError || !exported ? (
          <div className="p-4 space-y-2 text-sm">
            <p className="text-muted-foreground">
              No review export for this document yet. Run Review to export it
              and have the agent read it.
            </p>
            {exportError && (
              <p className="text-xs text-muted-foreground">
                {errorText(exportError)}
              </p>
            )}
            {findings.length > 0 && renderFindings(findings)}
          </div>
        ) : (
          <div className="font-mono text-sm" data-testid="doc-review-lines">
            {lines.map((text, index) => {
              const lineNumber = index + 1;
              const anchored = placed.get(lineNumber);
              return (
                <Fragment key={lineNumber}>
                  <div
                    className="flex items-stretch"
                    data-doc-line={lineNumber}
                  >
                    <span className="w-12 flex-shrink-0 pr-2 text-right text-muted-foreground select-none border-r border-border/40">
                      {lineNumber}
                    </span>
                    <div className="flex-1 px-[8px] py-[2px] whitespace-pre-wrap break-words">
                      {text || " "}
                    </div>
                  </div>
                  {anchored && renderFindings(anchored)}
                </Fragment>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
