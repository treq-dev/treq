import { Loader2, Search } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import {
  googleListDriveFiles,
  googlePrepareDocReview,
  type DriveFile,
} from "../../lib/api-google";
import { getRepoSetting } from "../../lib/api";
import { buildDocReviewPrompt } from "../../lib/google-doc-review";
import { useToastStore } from "../../stores/toastStore";
import { Input } from "../ui/input";
import { errorText } from "../../lib/errorText";
import { DriveFileRow } from "./DriveFileRow";

export interface DocReviewLaunch {
  prompt: string;
  agent?: string;
  title: string;
}

/**
 * Google Drive and Docs files, each with a review flow: export the file into
 * `~/Documents/treq/exports/`, run the review agent on it, then post
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
  const [reviewing, setReviewing] = useState(false);

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
    setReviewing(true);
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
      setReviewing(false);
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
          <DriveFileRow
            key={file.id}
            file={file}
            repoPath={repoPath}
            disabled={reviewing}
            onReview={startReview}
          />
        ))}
      </ul>
    </div>
  );
};
