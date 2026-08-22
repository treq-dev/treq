import { useActionState, useEffect, useState } from "react";
import { invalidateQueries } from "../lib/swr-cache";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { scheduleWorkspaces } from "../lib/api";
import { clearWorkspaceSchedule } from "../lib/clear-workspace-schedule";
import {
  addDaysAtHour,
  addHours,
  defaultScheduleDate,
  followingMondayAtNine,
  isWorkspaceHidden,
  nextWeekdayAt,
} from "../lib/workspace-utils";
import { Button } from "./ui/button";
import { FormPendingButton } from "./ui/form-pending-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Label } from "./ui/label";
import { useToast } from "./ui/toast";
import "./schedule-datepicker.css";

interface ScheduleWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoPath: string;
  workspaceIds: number[];
  /** Existing schedule for the first workspace, if any. */
  currentHiddenUntil?: string | null;
  /** True when any targeted workspace is currently scheduled. */
  canRemoveSchedule?: boolean;
  mode: "workspace" | "stack";
}

interface SchedulePreset {
  id: string;
  label: string;
  resolve: (now: Date) => Date;
}

const INTERVAL_PRESETS: SchedulePreset[] = [
  { id: "1h", label: "1 hour", resolve: (now) => addHours(now, 1) },
  { id: "4h", label: "4 hours", resolve: (now) => addHours(now, 4) },
  {
    id: "tomorrow-9",
    label: "Tomorrow 9am",
    resolve: (now) => addDaysAtHour(now, 1, 9),
  },
  {
    id: "3d",
    label: "3 days",
    resolve: (now) => addDaysAtHour(now, 3, 9),
  },
  {
    id: "1w",
    label: "1 week",
    resolve: (now) => addDaysAtHour(now, 7, 9),
  },
];

const WEEK_PRESETS: SchedulePreset[] = [
  {
    id: "mon-9",
    label: "Mon 9am",
    resolve: (now) => nextWeekdayAt(now, 1, 9),
  },
  {
    id: "fri-17",
    label: "Fri 5pm",
    resolve: (now) => nextWeekdayAt(now, 5, 17),
  },
  {
    id: "sat-9",
    label: "Sat 9am",
    resolve: (now) => nextWeekdayAt(now, 6, 9),
  },
  {
    id: "next-mon",
    label: "Next Mon",
    resolve: (now) => followingMondayAtNine(now),
  },
];

function datesMatchMinute(left: Date, right: Date): boolean {
  return Math.abs(left.getTime() - right.getTime()) < 60_000;
}

export const ScheduleWorkspaceDialog: React.FC<
  ScheduleWorkspaceDialogProps
> = ({
  open,
  onOpenChange,
  repoPath,
  workspaceIds,
  currentHiddenUntil,
  canRemoveSchedule = false,
  mode,
}) => {
  const [selected, setSelected] = useState<Date>(defaultScheduleDate());
  const { addToast } = useToast();

  useEffect(() => {
    if (!open) return;
    if (currentHiddenUntil) {
      const parsed = new Date(currentHiddenUntil);
      setSelected(
        Number.isNaN(parsed.getTime()) ? defaultScheduleDate() : parsed,
      );
    } else {
      setSelected(defaultScheduleDate());
    }
  }, [open, currentHiddenUntil]);

  const invalidate = () => {
    void invalidateQueries(["workspaces"]);
    void invalidateQueries(["workspace-statuses"]);
  };

  const [error, scheduleAction] = useActionState(
    async (_prev: string, formData: FormData) => {
      const intent = String(formData.get("intent") ?? "schedule");
      try {
        if (intent === "remove") {
          await clearWorkspaceSchedule(repoPath, workspaceIds);
          addToast({
            title:
              mode === "stack" ? "Stack unscheduled" : "Workspace unscheduled",
            description: "Shown in the sidebar again.",
            type: "success",
          });
        } else {
          await scheduleWorkspaces(
            repoPath,
            workspaceIds,
            selected.toISOString(),
          );
          addToast({
            title: mode === "stack" ? "Stack scheduled" : "Workspace scheduled",
            description: "Hidden in the sidebar until the scheduled time.",
            type: "success",
          });
          invalidate();
        }
        onOpenChange(false);
        return "";
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    },
    "",
  );

  const showRemove =
    canRemoveSchedule ||
    isWorkspaceHidden({ hidden_until: currentHiddenUntil });

  const now = new Date();
  const count = workspaceIds.length;
  const title = mode === "stack" ? "Schedule stack" : "Schedule workspace";
  const description =
    mode === "stack"
      ? `Hide ${count} workspace${count === 1 ? "" : "s"} in this stack until the chosen time. Directories stay on disk.`
      : "Hide this workspace in the sidebar until the chosen time. The directory stays on disk.";

  const renderPresets = (presets: SchedulePreset[]) =>
    presets.map((preset) => {
      const target = preset.resolve(now);
      const active = datesMatchMinute(selected, target);
      return (
        <Button
          key={preset.id}
          type="button"
          size="xs"
          variant={active ? "default" : "outline"}
          data-testid={`schedule-preset-${preset.id}`}
          onClick={() => setSelected(preset.resolve(new Date()))}
        >
          {preset.label}
        </Button>
      );
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xl"
        data-testid="schedule-workspace-dialog"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>Hide until</Label>
            <div className="flex flex-wrap gap-1.5">
              {renderPresets(INTERVAL_PRESETS)}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {renderPresets(WEEK_PRESETS)}
            </div>
            <DatePicker
              inline
              selected={selected}
              onChange={(date: Date | null) => {
                if (date) setSelected(date);
              }}
              showTimeSelect
              timeIntervals={15}
              timeCaption="Time"
              calendarClassName="treq-schedule-picker"
              minDate={new Date()}
            />
          </div>
          {error && <div className="text-sm text-destructive">{error}</div>}
        </div>
        <form action={scheduleAction} className="contents">
          <div className="flex justify-end gap-2">
            {showRemove && (
              <FormPendingButton
                variant="outline"
                name="intent"
                value="remove"
                data-testid="remove-schedule-button"
              >
                Remove schedule
              </FormPendingButton>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <FormPendingButton
              name="intent"
              value="schedule"
              pendingLabel="Scheduling..."
              disabled={Number.isNaN(selected.getTime())}
            >
              Schedule
            </FormPendingButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
