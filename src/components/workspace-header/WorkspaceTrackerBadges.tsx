import { openUrl } from "@tauri-apps/plugin-opener";
import { CheckCircle2, ListChecks, Zap } from "lucide-react";
import type { GoogleTaskWorkspaceMetadata } from "../../lib/google-tasks";
import { TRACKER_PROVIDERS, type TrackerProvider } from "../../lib/trackers";
import { usePreviewFeature } from "../../stores/featurePreviewStore";
import { TRACKER_ICONS } from "../trackerIcons";

/** Issue-tracker fields a workspace may carry in its `metadata` JSON. */
export interface WorkspaceTrackerMetadata extends GoogleTaskWorkspaceMetadata {
  linear_issue_key?: string;
  linear_issue_url?: string;
  linear_issue_title?: string;
  tracker_provider?: TrackerProvider;
  tracker_item_key?: string;
  tracker_item_url?: string;
  tracker_item_title?: string;
}

const BADGE_CLASS =
  "flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-xs font-medium text-muted-foreground hover:bg-muted/80 transition-colors shrink-0";

/**
 * Header badges linking to the workspace's Linear issue, Trello/Jira item and
 * Google Task.
 * Each badge renders only when its integration preview is on.
 */
export const WorkspaceTrackerBadges = ({
  metadata,
}: {
  metadata: WorkspaceTrackerMetadata | null;
}) => {
  const linearEnabled = usePreviewFeature("linearIntegration");
  const googleEnabled = usePreviewFeature("googleWorkspace");
  const trackerEnabled: Record<TrackerProvider, boolean> = {
    trello: usePreviewFeature("trelloIntegration"),
    jira: usePreviewFeature("jiraIntegration"),
  };
  if (!metadata) return null;

  const provider = metadata.tracker_provider;
  const showTracker =
    provider &&
    provider in TRACKER_PROVIDERS &&
    trackerEnabled[provider] &&
    metadata.tracker_item_key &&
    metadata.tracker_item_url;
  const TrackerIcon = provider ? TRACKER_ICONS[provider] : null;

  return (
    <>
      {linearEnabled &&
        metadata.linear_issue_key &&
        metadata.linear_issue_url && (
          <button
            type="button"
            onClick={() => void openUrl(metadata.linear_issue_url!)}
            data-testid="linear-issue-badge"
            title={metadata.linear_issue_title}
            className={BADGE_CLASS}
          >
            <Zap className="w-3 h-3" />
            {metadata.linear_issue_key}
          </button>
        )}
      {showTracker && TrackerIcon && (
        <button
          type="button"
          onClick={() => void openUrl(metadata.tracker_item_url!)}
          data-testid="tracker-item-badge"
          title={metadata.tracker_item_title}
          className={BADGE_CLASS}
        >
          <TrackerIcon className="w-3 h-3" />
          {metadata.tracker_item_key}
        </button>
      )}
      {googleEnabled && metadata.google_task_id && (
        <GoogleTaskBadge metadata={metadata} />
      )}
    </>
  );
};

const GOOGLE_TASK_LABEL_LIMIT = 32;

const GoogleTaskBadge = ({
  metadata,
}: {
  metadata: GoogleTaskWorkspaceMetadata;
}) => {
  const title = metadata.google_task_title?.trim() || "Google Task";
  const label =
    title.length > GOOGLE_TASK_LABEL_LIMIT
      ? `${title.slice(0, GOOGLE_TASK_LABEL_LIMIT - 1)}…`
      : title;
  const done = metadata.google_task_completed === true;
  const Icon = done ? CheckCircle2 : ListChecks;
  const url = metadata.google_task_url;
  return (
    <button
      type="button"
      onClick={() => url && void openUrl(url)}
      disabled={!url}
      data-testid="google-task-badge"
      data-completed={done}
      title={done ? `${title} (completed in Google Tasks)` : title}
      className={BADGE_CLASS}
    >
      <Icon
        className={`w-3 h-3 ${done ? "text-green-600 dark:text-green-400" : ""}`}
      />
      <span className={done ? "line-through" : undefined}>{label}</span>
    </button>
  );
};
