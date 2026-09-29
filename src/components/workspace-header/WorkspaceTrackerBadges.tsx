import { openUrl } from "@tauri-apps/plugin-opener";
import { Zap } from "lucide-react";
import { TRACKER_PROVIDERS, type TrackerProvider } from "../../lib/trackers";
import { usePreviewFeature } from "../../stores/featurePreviewStore";
import { TRACKER_ICONS } from "../trackerIcons";

/** Issue-tracker fields a workspace may carry in its `metadata` JSON. */
export interface WorkspaceTrackerMetadata {
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
 * Header badges linking to the workspace's Linear issue and Trello/Jira item.
 * Each badge renders only when its integration preview is on.
 */
export const WorkspaceTrackerBadges = ({
  metadata,
}: {
  metadata: WorkspaceTrackerMetadata | null;
}) => {
  const linearEnabled = usePreviewFeature("linearIntegration");
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
    </>
  );
};
