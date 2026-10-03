import { GitBranch } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { useCreateWorkspacePr } from "../../hooks/useCreateWorkspacePr";
import { cachedPrStatusesKey } from "../../hooks/useMergeQueueStatus";
import { useRepositoryCacheKey } from "../../lib/active-repository-context";
import {
  getRepoDefaultBranch,
  getWorkspaces,
  pushWorkspaceToRemote,
} from "../../lib/api";
import { listCachedPrStatuses } from "../../lib/api-pr-status";
import type { Workspace } from "../../lib/api-types";
import { deriveConventionalPrTitle } from "../../lib/github-pr";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Textarea } from "../ui/textarea";
import { CreatePrForm, type PrType, PrTypeSplitButton } from "./CreatePrForm";

interface NewPrDialogProps {
  repoPath: string;
  repoFullName: string;
  onSuccess: (prNumber: number) => void;
  onCancel: () => void;
}

export function NewPrDialog(props: NewPrDialogProps) {
  const [tab, setTab] = useState("workspace");
  return (
    <Dialog open onOpenChange={(open) => !open && props.onCancel()}>
      <DialogContent className="w-[36rem] max-w-[calc(100vw-2rem)] space-y-4">
        <DialogHeader>
          <DialogTitle>New Pull Request</DialogTitle>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="text-base">
            <TabsTrigger value="workspace">From workspace</TabsTrigger>
            <TabsTrigger value="branch">From branch</TabsTrigger>
          </TabsList>
          <TabsContent value="workspace" className="pt-4">
            <CreatePrFromWorkspaceForm {...props} />
          </TabsContent>
          <TabsContent value="branch" className="pt-4">
            <CreatePrForm {...props} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/** Workspaces that can take a new PR: not archived, not the default branch, no open PR. */
function useWorkspacesWithoutOpenPr(repoPath: string) {
  const repoCacheKey = useRepositoryCacheKey(repoPath);
  const { data: workspaces } = useSWR(["workspaces", repoCacheKey], () =>
    getWorkspaces(repoPath),
  );
  const { data: prStatuses } = useSWR(cachedPrStatusesKey(repoPath), () =>
    listCachedPrStatuses(repoPath),
  );
  const { data: defaultBranch, error: defaultBranchError } = useSWR(
    ["repo-default-branch", repoPath],
    () => getRepoDefaultBranch(repoPath),
  );
  // Wait for the default branch so its workspace is never listed. If it
  // can't be read, list everything and let the user type the base.
  const defaultBranchSettled =
    defaultBranch !== undefined || defaultBranchError !== undefined;
  if (!workspaces || !prStatuses || !defaultBranchSettled) {
    return { defaultBranch, workspaces: null };
  }
  return {
    defaultBranch,
    workspaces: workspaces.filter(
      (ws) =>
        !ws.archived &&
        ws.branch_name !== defaultBranch &&
        prStatuses[ws.branch_name]?.state !== "OPEN",
    ),
  };
}

function CreatePrFromWorkspaceForm({
  repoPath,
  repoFullName,
  onSuccess,
  onCancel,
}: NewPrDialogProps) {
  const { workspaces, defaultBranch } = useWorkspacesWithoutOpenPr(repoPath);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = workspaces?.find((ws) => ws.id === selectedId) ?? null;

  return (
    <div className="space-y-3">
      {workspaces === null ? (
        <p className="text-base text-muted-foreground">Loading workspaces…</p>
      ) : workspaces.length === 0 ? (
        <p className="text-base text-muted-foreground">
          Every workspace already has an open pull request.
        </p>
      ) : (
        <div
          role="radiogroup"
          aria-label="Workspace"
          className="max-h-60 overflow-y-auto rounded-md border border-border"
        >
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              type="button"
              role="radio"
              aria-checked={ws.id === selectedId}
              onClick={() => setSelectedId(ws.id)}
              className={cn(
                "w-full text-left px-3 py-2 border-b border-border last:border-b-0 hover:bg-muted/50 transition-colors",
                ws.id === selectedId && "bg-primary/10",
              )}
            >
              <p className="text-base font-medium truncate">
                {ws.title || ws.branch_name}
              </p>
              <p className="flex items-center gap-1 text-sm text-muted-foreground font-mono min-w-0">
                <GitBranch className="w-3 h-3 shrink-0" />
                <span className="truncate">{ws.branch_name}</span>
                <span className="shrink-0">→</span>
                <span className="truncate">
                  {ws.target_branch ?? defaultBranch}
                </span>
              </p>
            </button>
          ))}
        </div>
      )}
      {selected ? (
        <WorkspacePrFields
          key={selected.id}
          repoPath={repoPath}
          repoFullName={repoFullName}
          workspace={selected}
          defaultBase={selected.target_branch ?? defaultBranch ?? ""}
          onSuccess={onSuccess}
          onCancel={onCancel}
        />
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="text-base"
          onClick={onCancel}
        >
          Cancel
        </Button>
      )}
    </div>
  );
}

function WorkspacePrFields({
  repoPath,
  repoFullName,
  workspace,
  defaultBase,
  onSuccess,
  onCancel,
}: {
  repoPath: string;
  repoFullName: string;
  workspace: Workspace;
  defaultBase: string;
  onSuccess: (prNumber: number) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(() =>
    deriveConventionalPrTitle(workspace.title ?? "", workspace.branch_name),
  );
  const [body, setBody] = useState(workspace.description ?? "");
  // null until the user edits it, so the field follows the repo's default
  // branch if that loads after the workspace is picked.
  const [editedBase, setEditedBase] = useState<string | null>(null);
  const base = editedBase ?? defaultBase;
  const [prType, setPrType] = useState<PrType>("ready");
  const { createPr, isPending } = useCreateWorkspacePr(repoPath, workspace.id);

  const create = async () => {
    const number = await createPr({
      repoFullName,
      branchName: workspace.branch_name,
      baseBranch: base,
      body,
      draft: prType === "draft",
      // gh needs the branch on the remote. Pushing an in-sync branch is a no-op.
      prepare: async () => {
        await pushWorkspaceToRemote(repoPath, workspace.id);
        return title;
      },
    });
    if (number != null) onSuccess(number);
  };

  return (
    <>
      <Input
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="text-base"
      />
      <Input
        placeholder="Base branch"
        aria-label="Base branch"
        value={base}
        onChange={(e) => setEditedBase(e.target.value)}
        className="text-base font-mono"
      />
      <Textarea
        placeholder="Description (optional)"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        className="text-base"
      />
      <div className="flex gap-2">
        <PrTypeSplitButton
          prType={prType}
          onPrTypeChange={setPrType}
          pending={isPending}
          disabled={!title.trim() || !base.trim()}
          onCreate={() => void create()}
        />
        <Button
          size="sm"
          variant="ghost"
          className="text-base"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </>
  );
}
