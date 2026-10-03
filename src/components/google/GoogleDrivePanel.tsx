import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ExternalLink,
  FileText,
  Loader2,
  Search,
  Send,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import {
  GOOGLE_DOC_REVIEW_TARGET,
  googleListDriveFiles,
  googlePostReviewComments,
  googlePrepareDocReview,
  type DriveFile,
} from "../../lib/api-google";

import { getRepoSetting, listAgentReviewComments } from "../../lib/api";
import { buildDocReviewPrompt } from "../../lib/google-doc-review";
import { useToastStore } from "../../stores/toastStore";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export interface DocReviewLaunch {
  prompt: string;
  agent?: string;
  title: string;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Google Drive and Docs files, each with a review flow: export the file into
 * the repo's `.treq/google-review/`, run the review agent on it, then post
 * its findings back to the file as Drive comments.
 */
export const GoogleDrivePanel: React.FC<{
  repoPath: string;
  onStartReview: (launch: DocReviewLaunch) => void | Promise<void>;
}> = ({ repoPath, onStartReview }) => {
  const { addToast } = useToastStore();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [docsOnly, setDocsOnly] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const {
    data: files,
    error,
    isLoading,
  } = useSWR(
    ["google-drive-files", query, docsOnly],
    () => googleListDriveFiles(query || undefined, docsOnly),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const startReview = async (file: DriveFile) => {
    setBusy(`review:${file.id}`);
    try {
      const prepared = await googlePrepareDocReview(repoPath, file.id);
      const [instructions, agent] = await Promise.all([
        getRepoSetting(repoPath, "google_review_prompt").catch(() => null),
        getRepoSetting(repoPath, "review_agent").catch(() => null),
      ]);
      await onStartReview({
        prompt: buildDocReviewPrompt(prepared, instructions),
        agent: agent || undefined,
        title: `Review: ${file.name}`,
      });
    } catch (e) {
      addToast({
        title: "Failed to start review",
        description: errorText(e),
        type: "error",
      });
    } finally {
      setBusy(null);
    }
  };

  const postComments = async (file: DriveFile) => {
    setBusy(`post:${file.id}`);
    try {
      const open = (
        await listAgentReviewComments(
          repoPath,
          GOOGLE_DOC_REVIEW_TARGET,
          file.id,
        )
      ).filter((c) => c.status === "open");
      if (open.length === 0) {
        addToast({
          title: "No review comments to post",
          description:
            "Run a review first, or all comments are already posted.",
          type: "info",
        });
        return;
      }
      const posted = await googlePostReviewComments(repoPath, file.id);
      addToast({
        title: `Posted ${posted} comment${posted === 1 ? "" : "s"}`,
        description: file.name,
        type: "success",
      });
    } catch (e) {
      addToast({
        title: "Failed to post comments",
        description: errorText(e),
        type: "error",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 px-4 pb-4">
      <form
        className="flex items-center gap-2 pb-3"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(search.trim());
        }}
      >
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Drive"
            aria-label="Search Drive"
          />
        </div>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground whitespace-nowrap">
          <input
            type="checkbox"
            checked={docsOnly}
            onChange={(e) => setDocsOnly(e.target.checked)}
          />
          Docs only
        </label>
      </form>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading files…
        </div>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {errorText(error)}
        </p>
      )}
      {files && files.length === 0 && (
        <p className="text-sm text-muted-foreground">No files found.</p>
      )}

      <ul
        className="flex-1 overflow-y-auto divide-y divide-border"
        data-testid="google-drive-files"
      >
        {(files ?? []).map((file) => (
          <li key={file.id} className="flex items-center gap-3 py-2">
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
            <Button
              variant="outline"
              size="sm"
              disabled={!file.reviewable || busy !== null}
              title={
                file.reviewable
                  ? undefined
                  : "Only Docs, Sheets, Slides and text files can be reviewed"
              }
              onClick={() => void startReview(file)}
            >
              {busy === `review:${file.id}` ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              Review
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!file.reviewable || busy !== null}
              onClick={() => void postComments(file)}
            >
              {busy === `post:${file.id}` ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              Post comments
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
};
