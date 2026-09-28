import { CalendarClock } from "lucide-react";
import { useState } from "react";
import type { Workspace } from "../../lib/api";
import { isWorkspaceHidden } from "../../lib/workspace-utils";
import { usePreviewFeature } from "../../stores/featurePreviewStore";
import { ScheduleWorkspaceDialog } from "../ScheduleWorkspaceDialog";
import { Button } from "../ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";

interface ScheduleTarget {
  mode: "workspace" | "stack";
  workspaceIds: number[];
  currentHiddenUntil?: string | null;
  canRemoveSchedule?: boolean;
}

/**
 * Workspace scheduling (preview): the header Schedule button, the stack
 * panel's schedule callback, and the shared dialog. All three are null or
 * undefined when the preview is off or there is no workspace.
 */
export function useWorkspaceScheduling(
  repoPath: string,
  workspace: Workspace | null,
) {
  const enabled = usePreviewFeature("workspaceScheduling");
  const [target, setTarget] = useState<ScheduleTarget | null>(null);

  if (!enabled || !workspace) {
    return { button: null, dialog: null, onScheduleStack: undefined };
  }

  const onScheduleStack = (stackWorkspaces: Workspace[]) =>
    setTarget({
      mode: "stack",
      workspaceIds: stackWorkspaces.map((ws) => ws.id),
      currentHiddenUntil: stackWorkspaces.find((ws) => isWorkspaceHidden(ws))
        ?.hidden_until,
      canRemoveSchedule: stackWorkspaces.some((ws) => isWorkspaceHidden(ws)),
    });

  const button = (
    <TooltipProvider delay={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setTarget({
                mode: "workspace",
                workspaceIds: [workspace.id],
                currentHiddenUntil: workspace.hidden_until,
                canRemoveSchedule: isWorkspaceHidden(workspace),
              })
            }
            data-testid="schedule-workspace-button"
          >
            <CalendarClock className="w-4 h-4" />
            Schedule
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Hide this workspace in the sidebar until a chosen time
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );

  const dialog = (
    <ScheduleWorkspaceDialog
      open={!!target}
      onOpenChange={(open) => {
        if (!open) setTarget(null);
      }}
      repoPath={repoPath}
      workspaceIds={target?.workspaceIds ?? [workspace.id]}
      currentHiddenUntil={target?.currentHiddenUntil}
      canRemoveSchedule={target?.canRemoveSchedule}
      mode={target?.mode ?? "workspace"}
    />
  );

  return { button, dialog, onScheduleStack };
}
