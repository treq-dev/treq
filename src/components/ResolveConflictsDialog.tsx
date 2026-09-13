import { useActionState, useState } from "react";
import useSWR from "swr";
import { CircleHelp, ExternalLink, Loader2 } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  buildResolveAgentPrompt,
  createSession,
  getRepoSetting,
  getSetting,
  startResolveConflicts,
} from "../lib/api";
import { WEB_URL } from "../lib/supabase";
import type { SessionCreationInfo } from "../types/sessions";
import { Button } from "./ui/button";
import { FormPendingButton } from "./ui/form-pending-button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { useToast } from "./ui/toast";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

const RESOLVE_DOCS_URL = `${WEB_URL}/docs/concepts/commit-management#resolve-commit-conflicts-inplace`;

interface ResolveConflictsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoPath: string;
  workspaceId: number | null;
  /** When set, only these change ids are resolved; otherwise all conflicted commits. */
  changeIds?: string[] | null;
  onSessionCreated: (session: SessionCreationInfo) => void;
}

export const ResolveConflictsDialog: React.FC<ResolveConflictsDialogProps> = ({
  open,
  onOpenChange,
  repoPath,
  workspaceId,
  changeIds = null,
  onSessionCreated,
}) => {
  const [prompt, setPrompt] = useState("");
  const { addToast } = useToast();
  const changeIdsKey = JSON.stringify(changeIds ?? null);
  const {
    data: session,
    isLoading: preparing,
    error: prepareError,
  } = useSWR(
    open
      ? ["start-resolve-conflicts", repoPath, workspaceId, changeIdsKey]
      : null,
    () => startResolveConflicts(repoPath, workspaceId, changeIds),
    {
      onError: (error) => {
        addToast({
          title: "Failed to prepare resolve workspaces",
          description: error instanceof Error ? error.message : String(error),
          type: "error",
        });
      },
    },
  );
  void prepareError;

  const [, resolveAction, submitting] = useActionState(async () => {
    try {
      const resolveSession =
        session ??
        (await startResolveConflicts(repoPath, workspaceId, changeIds));

      const fullPrompt = await buildResolveAgentPrompt(
        prompt.trim(),
        resolveSession,
      );

      let resolvedAgent: "claude" | "codex" | "cursor" | "copilot" = "claude";
      try {
        const repoDefault = await getRepoSetting(repoPath, "default_agent");
        const appDefault = await getSetting("default_agent");
        const pick = repoDefault || appDefault;
        if (
          pick === "codex" ||
          pick === "cursor" ||
          pick === "copilot" ||
          pick === "claude"
        ) {
          resolvedAgent = pick;
        }
      } catch {
        // keep default
      }

      const [primary] = resolveSession.targets;
      if (!primary) {
        throw new Error("No resolve targets were created");
      }

      const sessionName =
        resolveSession.targets.length > 1
          ? "Resolve conflicts"
          : `Resolve ${primary.change_id.slice(0, 8)}`;

      const dbSessionId = await createSession(
        repoPath,
        resolveSession.source_workspace_id ?? primary.workspace_id,
        sessionName,
      );

      onSessionCreated({
        sessionId: dbSessionId,
        sessionName,
        workspaceId: resolveSession.source_workspace_id ?? primary.workspace_id,
        workspacePath: resolveSession.agent_cwd,
        repoPath,
        pendingPrompt: fullPrompt,
        permissionMode: "acceptEdits",
        agent: resolvedAgent,
      });

      addToast({
        title: "Resolve session started",
        description: `${resolveSession.targets.length} resolve director${
          resolveSession.targets.length === 1 ? "y" : "ies"
        } ready for the agent`,
        type: "success",
      });
      onOpenChange(false);
    } catch (error) {
      addToast({
        title: "Failed to start resolve",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    }
    return null;
  }, null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex w-[42vw] max-w-none flex-col gap-y-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            <span>Resolve commit conflicts inplace</span>
            <TooltipProvider delay={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Help: resolve commit conflicts inplace"
                    data-testid="resolve-conflicts-help"
                    className="inline-flex items-center justify-center rounded-sm text-muted-foreground/70 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <CircleHelp className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs font-normal">
                  <p>
                    Treq opens short-lived resolve directories for each
                    conflicted commit and starts an agent there. Resolving
                    rewrites the commit in place. It does not add a follow-up
                    resolution commit, and it leaves your product workspace
                    untouched.
                  </p>
                  <button
                    type="button"
                    className="mt-1.5 inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
                    onClick={() => openUrl(RESOLVE_DOCS_URL)}
                    onPointerDown={(event) => event.preventDefault()}
                  >
                    Learn more
                    <ExternalLink className="h-3 w-3" />
                  </button>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </DialogTitle>
        </DialogHeader>

        <form action={resolveAction} className="contents">
          <textarea
            className="min-h-[120px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            placeholder="e.g. Prefer the workspace-side changes in README, keep both imports in lib.rs…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={submitting}
            name="prompt"
            data-testid="resolve-conflicts-prompt"
          />

          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <FormPendingButton
              pendingLabel="Starting…"
              disabled={preparing || !session}
              data-testid="resolve-conflicts-submit"
            >
              {preparing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Preparing…
                </>
              ) : (
                "Resolve"
              )}
            </FormPendingButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
