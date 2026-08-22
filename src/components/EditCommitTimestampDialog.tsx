import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { useToast } from "./ui/toast";
import {
  type JjLogCommit,
  shiftCommitTimestamp,
  shiftMutableCommitsToNow,
} from "../lib/api";
import { formatFullTimestamp } from "../lib/utils";

interface EditCommitTimestampDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoPath: string;
  workspaceId: number;
  commit: JjLogCommit | null;
  onSuccess: () => void;
}

type Mode = "offset" | "day";

export const EditCommitTimestampDialog: React.FC<
  EditCommitTimestampDialogProps
> = ({ open, onOpenChange, repoPath, workspaceId, commit, onSuccess }) => {
  const [mode, setMode] = useState<Mode>("offset");
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [days, setDays] = useState("0");
  const [hours, setHours] = useState("0");
  const [minutes, setMinutes] = useState("0");
  const [toDay, setToDay] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { addToast } = useToast();

  const canSubmit = (() => {
    if (!commit || saving) return false;
    if (mode === "day") return /^\d{4}-\d{2}-\d{2}$/.test(toDay);
    const d = Number(days);
    const h = Number(hours);
    const m = Number(minutes);
    if (![d, h, m].every((n) => Number.isInteger(n) && n >= 0)) return false;
    return d + h + m > 0;
  })();

  const handleSave = async () => {
    if (!commit || !canSubmit) return;

    setSaving(true);
    setError("");

    try {
      const sign = direction === "back" ? -1 : 1;
      await shiftCommitTimestamp(repoPath, workspaceId, commit.change_id, {
        days: mode === "offset" ? sign * Number(days) : 0,
        hours: mode === "offset" ? sign * Number(hours) : 0,
        minutes: mode === "offset" ? sign * Number(minutes) : 0,
        toDay: mode === "day" ? toDay : null,
      });

      addToast({
        title: "Timestamp updated",
        description: `Updated commit ${commit.short_id} and repaired later commits on this lineage`,
        type: "success",
      });

      onSuccess();
      onOpenChange(false);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
      addToast({
        title: "Failed to update timestamp",
        description: errorMsg,
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSave();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>Edit commit timestamp</DialogTitle>
          <DialogDescription>
            {commit
              ? `Current time: ${formatFullTimestamp(commit.timestamp)}`
              : "Shift a mutable commit in time"}
            . Later commits on this lineage that would become older are shifted
            by the same gaps.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={mode === "offset" ? "default" : "outline"}
              onClick={() => setMode("offset")}
            >
              Shift by duration
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === "day" ? "default" : "outline"}
              onClick={() => setMode("day")}
            >
              Move to day
            </Button>
          </div>

          {mode === "offset" ? (
            <>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={direction === "forward" ? "default" : "outline"}
                  onClick={() => setDirection("forward")}
                >
                  Forward
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={direction === "back" ? "default" : "outline"}
                  onClick={() => setDirection("back")}
                >
                  Back
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="shift-days">Days</Label>
                  <Input
                    id="shift-days"
                    type="number"
                    min={0}
                    value={days}
                    onChange={(e) => setDays(e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="shift-hours">Hours</Label>
                  <Input
                    id="shift-hours"
                    type="number"
                    min={0}
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="shift-minutes">Minutes</Label>
                  <Input
                    id="shift-minutes"
                    type="number"
                    min={0}
                    value={minutes}
                    onChange={(e) => setMinutes(e.target.value)}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor="shift-day">Day</Label>
              <Input
                id="shift-day"
                type="date"
                value={toDay}
                onChange={(e) => setToDay(e.target.value)}
              />
            </div>
          )}

          {error && <div className="text-sm text-destructive">{error}</div>}
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            onClick={async () => {
              if (saving) return;
              setSaving(true);
              setError("");
              try {
                await shiftMutableCommitsToNow(repoPath, workspaceId);
                addToast({
                  title: "Timestamps updated",
                  description:
                    "Mutable commits on this branch now end at the current time",
                  type: "success",
                });
                onSuccess();
                onOpenChange(false);
              } catch (err) {
                const errorMsg =
                  err instanceof Error ? err.message : String(err);
                setError(errorMsg);
                addToast({
                  title: "Failed to shift timestamps",
                  description: errorMsg,
                  type: "error",
                });
              } finally {
                setSaving(false);
              }
            }}
            disabled={saving}
            data-testid="shift-stack-to-now"
          >
            Shift stack to now
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!canSubmit}>
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Apply"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
