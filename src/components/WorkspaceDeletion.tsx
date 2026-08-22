import { useEffect, useState } from "react";
import { Command } from "cmdk";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { Workspace } from "../lib/api";
import { AlertTriangle, GitBranch, Home } from "lucide-react";
import { CmdkFooter } from "./ui/cmdk-footer";

interface WorkspaceDeletionProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaces: Workspace[];
  repoPath: string;
  currentWorkspace: Workspace | null;
  onDeleteWorkspace: (workspace: Workspace) => void;
}

export const WorkspaceDeletion: React.FC<WorkspaceDeletionProps> = ({
  open,
  onOpenChange,
  workspaces,
  repoPath,
  currentWorkspace,
  onDeleteWorkspace,
}) => {
  const [search, setSearch] = useState("");
  const [selectedValue, setSelectedValue] = useState<string>("");

  // Reset search and selection when dialog opens
  useEffect(() => {
    if (open) {
      setSearch("");
      if (currentWorkspace) {
        setSelectedValue(
          `workspace-${currentWorkspace.id}-${currentWorkspace.branch_name}`,
        );
      } else {
        setSelectedValue("");
      }
    }
  }, [open, currentWorkspace]);

  // Filter out home repo (workspaces that match the main repo path)
  const deletableWorkspaces = workspaces.filter(
    (w) => w.workspace_path !== repoPath,
  );

  const handleSelect = (value: string) => {
    if (value.startsWith("current-default")) {
      // User pressed enter without selecting - use current workspace
      if (currentWorkspace && currentWorkspace.workspace_path !== repoPath) {
        onDeleteWorkspace(currentWorkspace);
        onOpenChange(false);
      }
      return;
    }

    // Extract workspace ID from value format: workspace-{id}-{branch_name}
    const workspaceId = parseInt(value.split("-")[1], 10);
    const workspace = deletableWorkspaces.find((w) => w.id === workspaceId);
    if (workspace) {
      onDeleteWorkspace(workspace);
      onOpenChange(false);
    }
  };

  const hasCurrentWorkspace =
    currentWorkspace && currentWorkspace.workspace_path !== repoPath;

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Delete Workspace"
      value={selectedValue}
      onValueChange={setSelectedValue}
      className="[&_[cmdk-root]]:bg-background [&_[cmdk-root]]:text-foreground"
    >
      <VisuallyHidden.Root>
        <DialogPrimitive.Title>Delete Workspace</DialogPrimitive.Title>
        <DialogPrimitive.Description>
          Delete workspace
        </DialogPrimitive.Description>
      </VisuallyHidden.Root>
      <div
        data-testid="modal"
        className="bg-background text-foreground rounded-xl border border-border shadow-2xl w-[40vw] max-w-none overflow-hidden"
      >
        {/* Header with warning */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-destructive/10">
          <AlertTriangle className="w-4 h-4 text-destructive" />
          <span className="text-sm font-medium text-destructive">
            Delete Workspace
          </span>
        </div>

        {/* Search Input */}
        <div className="flex items-center border-b border-border px-3 bg-background">
          <Command.Input
            value={search}
            onValueChange={setSearch}
            placeholder="Search workspaces to delete..."
            className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0 h-12 flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground text-foreground"
          />
        </div>

        {/* Results List */}
        <Command.List className="max-h-[300px] overflow-y-auto py-2">
          <Command.Empty>
            <div className="px-4 py-8 text-center text-muted-foreground text-sm">
              No deletable workspaces found
            </div>
          </Command.Empty>

          {/* Current workspace as default (if not home repo) */}
          {hasCurrentWorkspace && (
            <Command.Item
              value={`current-default-${currentWorkspace.branch_name}`}
              onSelect={handleSelect}
              className="px-3 py-1.5 mx-2 rounded-md flex items-center gap-3 cursor-pointer text-foreground aria-selected:bg-accent/50 aria-selected:text-foreground data-[disabled='true']:opacity-50 data-[disabled='true']:pointer-events-none hover:bg-accent/30 transition-colors"
            >
              <span className="text-muted-foreground">
                <GitBranch className="w-4 h-4" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="truncate text-sm font-medium">
                  {currentWorkspace.branch_name}
                </div>
                <div className="truncate text-sm text-muted-foreground">
                  Current workspace (default)
                </div>
              </div>
            </Command.Item>
          )}

          {/* All deletable workspaces */}
          {deletableWorkspaces.map((workspace) => {
            const isCurrent = currentWorkspace?.id === workspace.id;
            return (
              <Command.Item
                key={workspace.id}
                value={`workspace-${workspace.id}-${workspace.branch_name}`}
                onSelect={handleSelect}
                className="px-3 py-1.5 mx-2 rounded-md flex items-center gap-3 cursor-pointer text-foreground aria-selected:bg-accent/50 aria-selected:text-foreground data-[disabled='true']:opacity-50 data-[disabled='true']:pointer-events-none hover:bg-accent/30 transition-colors"
              >
                <span className="text-muted-foreground">
                  <GitBranch className="w-4 h-4" />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm font-medium">
                    {workspace.branch_name}
                    {isCurrent && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        (current)
                      </span>
                    )}
                  </div>
                </div>
              </Command.Item>
            );
          })}
        </Command.List>

        <CmdkFooter
          actions={[
            { key: "↑↓", label: "Navigate" },
            { key: "↵", label: "Delete" },
            { key: "Esc", label: "Cancel" },
          ]}
        />

        {/* Warning message */}
        {deletableWorkspaces.length === 0 && (
          <div className="px-4 py-3 border-t border-border bg-muted/30">
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Home className="w-4 h-4" />
              Home repository cannot be deleted
            </p>
          </div>
        )}
      </div>
    </Command.Dialog>
  );
};
