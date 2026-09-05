import type { ManagedInstanceState } from "../../lib/api-types-remote";

/**
 * Client-observed connection state for a remote repository, layered on top
 * of the control plane's `ManagedInstanceState` (which only applies to
 * managed VMs). "connecting", "reconnecting", and "stale" describe the
 * desktop client's own SSH transport / cache state and apply to both
 * managed and user-managed endpoints.
 */
export type RemoteConnectionState =
  | "online"
  | "connecting"
  | "reconnecting"
  | "waking"
  | "stale"
  | "offline"
  | "degraded"
  | "cutoff";

export function connectionStateFromInstanceState(
  instanceState: ManagedInstanceState | undefined,
  transportConnected: boolean,
): RemoteConnectionState {
  if (instanceState === "waking" || instanceState === "suspended") {
    return "waking";
  }
  if (instanceState === "degraded" || instanceState === "failed") {
    return "degraded";
  }
  if (instanceState === "reprovisioning") return "reconnecting";
  if (!transportConnected) return "offline";
  return "online";
}

const COPY: Record<
  RemoteConnectionState,
  { label: string; tone: "neutral" | "warning" | "danger" }
> = {
  online: { label: "Connected", tone: "neutral" },
  connecting: { label: "Connecting...", tone: "warning" },
  reconnecting: { label: "Reconnecting...", tone: "warning" },
  waking: { label: "Waking managed VM...", tone: "warning" },
  stale: { label: "Showing cached data - refreshing", tone: "warning" },
  offline: { label: "Offline", tone: "danger" },
  degraded: { label: "Degraded - some checks are failing", tone: "danger" },
  cutoff: {
    label: "Credential cutoff - reauthenticate to continue",
    tone: "danger",
  },
};

const TONE_CLASSES: Record<string, string> = {
  neutral: "bg-muted/60 text-muted-foreground border-border/50",
  warning:
    "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30",
  danger: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30",
};

export interface RemoteStatusBannerProps {
  state: RemoteConnectionState;
  detail?: string;
  onRefresh?: () => void;
  onReconnect?: () => void;
  onWake?: () => void;
}

/**
 * Visible connection-state indicator for a remote repository. Rendered
 * inline above the review/terminal surface so a degraded, offline, or
 * waking endpoint is never silent - see PRD "Main application integration":
 * "visible offline, waking, reconnecting, stale, and degraded states."
 */
export function RemoteStatusBanner({
  state,
  detail,
  onRefresh,
  onReconnect,
  onWake,
}: RemoteStatusBannerProps) {
  if (state === "online") return null;
  const copy = COPY[state];

  return (
    <div
      data-testid="remote-status-banner"
      data-state={state}
      className={`flex items-center justify-between gap-3 rounded-md border px-3 py-1.5 text-sm ${TONE_CLASSES[copy.tone]}`}
    >
      <span>
        <span className="font-medium">{copy.label}</span>
        {detail && <span className="text-muted-foreground"> - {detail}</span>}
      </span>
      <span className="flex items-center gap-2">
        {state === "waking" && onWake && (
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={onWake}
          >
            Wake now
          </button>
        )}
        {(state === "offline" || state === "reconnecting") && onReconnect && (
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={onReconnect}
          >
            Reconnect
          </button>
        )}
        {onRefresh && (
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={onRefresh}
          >
            Refresh
          </button>
        )}
      </span>
    </div>
  );
}
