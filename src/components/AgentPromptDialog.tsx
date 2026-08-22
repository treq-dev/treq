import { useEffect, useRef, useState } from "react";
import { Command } from "cmdk";
import { Check, ChevronsUpDown, GitBranch } from "lucide-react";
import type { Workspace } from "../lib/api";
import type { GitHubIssueAttachment } from "../lib/promptAttachments";
import type { SessionCreationInfo } from "../types/sessions";
import { cn } from "../lib/utils";
import { TaskInput } from "./TaskInput";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

interface AgentPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoPath: string;
  defaultBranch: string;
  workspaces: Workspace[];
  onSessionCreated: (session: SessionCreationInfo) => void;
  /** Pre-fill the prompt textarea with this text (e.g. re-running a past prompt). */
  initialPrompt?: string;
  /** Pre-select the workspace this prompt originally belonged to, if any. */
  initialWorkspaceId?: number | null;
  /** Pre-attach a GitHub issue chip when starting a prompt from an issue. */
  initialGitHubIssue?: GitHubIssueAttachment | null;
}

export const AgentPromptDialog: React.FC<AgentPromptDialogProps> = ({
  open,
  onOpenChange,
  repoPath,
  defaultBranch,
  workspaces,
  onSessionCreated,
  initialPrompt,
  initialWorkspaceId = null,
  initialGitHubIssue = null,
}) => {
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(
    null,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  // Bump on every closed -> open transition so TaskInput remounts with a
  // fresh initialPrompt instead of keeping stale text from a prior open.
  const [taskInputKey, setTaskInputKey] = useState(0);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setSelectedWorkspace(
        initialWorkspaceId != null
          ? (workspaces.find((ws) => ws.id === initialWorkspaceId) ?? null)
          : null,
      );
      setTaskInputKey((key) => key + 1);
    }
    wasOpenRef.current = open;
  }, [open, initialWorkspaceId, workspaces]);

  const selectableWorkspaces = workspaces.filter(
    (ws) => ws.branch_name !== defaultBranch,
  );
  const selectedName = selectedWorkspace?.branch_name ?? defaultBranch;
  const handleSessionCreated = (session: SessionCreationInfo) => {
    onSessionCreated(session);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex w-[40vw] max-w-none flex-col gap-y-4">
        <DialogHeader>
          <DialogTitle>Start a new agent session</DialogTitle>
        </DialogHeader>

        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={pickerOpen}
              className="w-fit min-w-[240px] max-w-full justify-between"
            >
              <span className="flex items-center gap-2 truncate">
                <GitBranch className="h-4 w-4" />
                {selectedName}
              </span>
              <ChevronsUpDown className="h-4 w-4 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="min-w-[240px] max-w-[400px] p-0"
            align="start"
          >
            <Command>
              <Command.Input
                placeholder="Search workspaces..."
                className="h-10 w-full border-b bg-transparent px-3 text-sm outline-none"
              />
              <Command.List className="max-h-64 overflow-y-auto p-1">
                <Command.Empty className="p-4 text-center text-sm text-muted-foreground">
                  No workspaces found
                </Command.Empty>
                <Command.Item
                  value={defaultBranch}
                  onSelect={() => {
                    setSelectedWorkspace(null);
                    setPickerOpen(false);
                  }}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 aria-selected:bg-accent"
                >
                  <Check
                    className={cn(
                      "h-4 w-4",
                      selectedWorkspace === null ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {defaultBranch}
                </Command.Item>
                {selectableWorkspaces.map((workspace) => (
                  <Command.Item
                    key={workspace.id}
                    value={workspace.branch_name}
                    onSelect={() => {
                      setSelectedWorkspace(workspace);
                      setPickerOpen(false);
                    }}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 aria-selected:bg-accent"
                  >
                    <Check
                      className={cn(
                        "h-4 w-4",
                        selectedWorkspace?.id === workspace.id
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                    />
                    {workspace.branch_name}
                  </Command.Item>
                ))}
              </Command.List>
            </Command>
          </PopoverContent>
        </Popover>

        <TaskInput
          key={taskInputKey}
          repoPath={repoPath}
          workspaceId={selectedWorkspace?.id ?? null}
          workspacePath={selectedWorkspace?.workspace_path ?? null}
          workingDirectory={selectedWorkspace?.workspace_path ?? repoPath}
          onSessionCreated={handleSessionCreated}
          initialText={initialPrompt}
          initialGitHubIssue={initialGitHubIssue}
        />
      </DialogContent>
    </Dialog>
  );
};
