import { useState } from "react";
import useSWR from "swr";
import { ChevronDown, Loader2 } from "lucide-react";
import { useMutation } from "../../hooks/useMutation";
import { invalidatePrStatuses } from "../../hooks/useMergeQueueStatus";
import { getRepoDefaultBranch, ghCreatePr } from "../../lib/api";
import { invalidateQueries } from "../../lib/swr-cache";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Textarea } from "../ui/textarea";

// Mirrors GitHub's split button: the menu picks the PR type and the main
// button then creates that type.
const PR_TYPES = {
  ready: {
    button: "Create Pull Request",
    item: "Create pull request",
    description: "Open a pull request that is ready for review",
  },
  draft: {
    button: "Draft Pull Request",
    item: "Create draft pull request",
    description: "Cannot be merged until marked ready for review",
  },
} as const;

type PrType = keyof typeof PR_TYPES;

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
  const [prType, setPrType] = useState<PrType>("ready");
  const draft = prType === "draft";

  const { data: defaultBranch } = useSWR(
    repoPath ? ["repo-default-branch", repoPath] : null,
    () => getRepoDefaultBranch(repoPath),
  );
  const base = editedBase ?? defaultBranch ?? "";

  const create = useMutation({
    mutationFn: () => ghCreatePr(repoFullName, title, body, base, head, draft),
    onSuccess: (prNumber) => {
      void invalidateQueries(["gh-prs", repoFullName]);
      void invalidatePrStatuses(repoPath, head);
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
      <div className="flex gap-2">
        <div className="inline-flex items-center">
          <Button
            size="sm"
            className="text-base rounded-r-none"
            disabled={
              !title.trim() || !head.trim() || !base.trim() || create.isPending
            }
            onClick={() => create.mutate()}
          >
            {create.isPending ? (
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            ) : null}
            {PR_TYPES[prType].button}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                className="rounded-l-none border-l border-white/20 px-1.5"
                disabled={create.isPending}
                aria-label="Pull request type"
              >
                <ChevronDown className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={4} className="w-80">
              <DropdownMenuRadioGroup
                value={prType}
                onValueChange={(value) => setPrType(value as PrType)}
              >
                {(Object.keys(PR_TYPES) as PrType[]).map((type) => (
                  <DropdownMenuRadioItem
                    key={type}
                    value={type}
                    closeOnClick
                    className="items-start"
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">{PR_TYPES[type].item}</span>
                      <span className="text-xs text-muted-foreground">
                        {PR_TYPES[type].description}
                      </span>
                    </div>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
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
