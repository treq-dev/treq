import { useState } from "react";
import useSWR from "swr";
import { Loader2 } from "lucide-react";
import { useMutation } from "../../hooks/useMutation";
import { invalidateQueries } from "../../lib/swr-cache";
import { getRepoDefaultBranch, ghCreatePr } from "../../lib/api";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";

export function CreatePrForm({
  repoPath,
  repoFullName,
  onSuccess,
  onCancel,
}: {
  repoPath: string;
  repoFullName: string;
  onSuccess: (prNumber: number) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  // null until the user edits it, so the field follows the repo's default
  // branch once that loads.
  const [editedBase, setEditedBase] = useState<string | null>(null);
  const [head, setHead] = useState("");
  const [draft, setDraft] = useState(false);

  const { data: defaultBranch } = useSWR(
    repoPath ? ["repo-default-branch", repoPath] : null,
    () => getRepoDefaultBranch(repoPath),
  );
  const base = editedBase ?? defaultBranch ?? "";

  const create = useMutation({
    mutationFn: () => ghCreatePr(repoFullName, title, body, base, head, draft),
    onSuccess: (prNumber) => {
      void invalidateQueries(["gh-prs", repoFullName]);
      onSuccess(prNumber);
    },
  });

  return (
    <div className="p-4 space-y-3 border-b border-border">
      <h3 className="text-base font-semibold">New Pull Request</h3>
      <Input
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="text-base"
      />
      <div className="flex gap-2 items-center">
        <Input
          placeholder="Head branch"
          value={head}
          onChange={(e) => setHead(e.target.value)}
          className="text-base font-mono"
        />
        <span className="text-muted-foreground text-base shrink-0">→</span>
        <Input
          placeholder="Base branch"
          value={base}
          onChange={(e) => setEditedBase(e.target.value)}
          className="text-base font-mono"
        />
      </div>
      <Textarea
        placeholder="Description (optional)"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        className="text-base"
      />
      <div className="flex items-center gap-2">
        <Switch
          id="create-pr-draft"
          aria-label="Create as draft"
          checked={draft}
          onCheckedChange={(checked) => setDraft(checked)}
        />
        <Label htmlFor="create-pr-draft" className="text-base">
          Create as draft
        </Label>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          className="text-base"
          disabled={
            !title.trim() || !head.trim() || !base.trim() || create.isPending
          }
          onClick={() => create.mutate()}
        >
          {create.isPending ? (
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
          ) : null}
          {draft ? "Create Draft Pull Request" : "Create Pull Request"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-base"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
      {create.isError && (
        <p className="text-base text-destructive">
          {create.error instanceof Error
            ? create.error.message
            : String(create.error)}
        </p>
      )}
    </div>
  );
}
