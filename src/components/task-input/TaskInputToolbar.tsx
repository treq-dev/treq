import { Paperclip, Plus } from "lucide-react";
import { AgentIcon } from "../icons/AgentIcons";
import { Button } from "../ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import type { AgentPermissionMode, AgentType } from "../../lib/agentDeepLink";

interface TaskInputToolbarProps {
  isEmpty: boolean;
  submitting: boolean;
  selectedAgent: AgentType;
  configuredDefaultAgent: AgentType;
  saveAsRepoDefault: boolean;
  showSaveAsRepoDefault: boolean;
  onOpenFilePicker: () => void;
  onAttachFromFinder: () => void;
  onAgentChange: (agent: AgentType) => void;
  onSaveAsRepoDefaultChange: (checked: boolean) => void;
  onSubmit: (mode: AgentPermissionMode) => void;
}

export const TaskInputToolbar: React.FC<TaskInputToolbarProps> = ({
  isEmpty,
  submitting,
  selectedAgent,
  configuredDefaultAgent,
  saveAsRepoDefault,
  showSaveAsRepoDefault,
  onOpenFilePicker,
  onAttachFromFinder,
  onAgentChange,
  onSaveAsRepoDefaultChange,
  onSubmit,
}) => (
  <div className="px-2 pb-2 pt-1 flex min-w-0 flex-wrap items-center justify-between gap-1">
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-xs px-2 gap-1"
        onClick={onOpenFilePicker}
      >
        <Plus className="w-4 h-4" />
        File
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-xs px-2 gap-1"
        onClick={onAttachFromFinder}
      >
        <Paperclip className="w-4 h-4" />
        Attach
      </Button>
    </div>

    <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
      {showSaveAsRepoDefault && selectedAgent !== configuredDefaultAgent && (
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={saveAsRepoDefault}
            onChange={(e) => onSaveAsRepoDefaultChange(e.target.checked)}
            className="h-3.5 w-3.5 accent-blue-500"
          />
          Set as default for this repo
        </label>
      )}
      <div className="flex items-center gap-1.5">
        <AgentIcon
          agent={selectedAgent}
          className="w-3.5 h-3.5 text-muted-foreground shrink-0"
        />
        <select
          aria-label="Agent"
          value={selectedAgent}
          onChange={(e) => onAgentChange(e.target.value as AgentType)}
          className="h-7 text-xs px-2 rounded-md border border-border bg-background text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-400"
        >
          <option value="claude">Claude</option>
          <option value="codex">Codex</option>
          <option value="cursor">Cursor</option>
          <option value="copilot">Copilot</option>
        </select>
      </div>
      {selectedAgent !== "codex" && selectedAgent !== "copilot" && (
        <Button
          size="sm"
          variant="secondary"
          disabled={isEmpty || submitting}
          onClick={() => onSubmit("plan")}
          className="h-7 text-xs px-3"
        >
          Plan
        </Button>
      )}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              disabled={isEmpty || submitting}
              onClick={() => onSubmit("acceptEdits")}
              className="h-7 text-xs px-3"
            >
              {selectedAgent === "claude" ? "Edit" : "Run"}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p className="text-xs">⌘+Enter</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  </div>
);
