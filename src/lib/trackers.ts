import type { PreviewFeatureId } from "./features";

/** Issue trackers served by the shared `tracker_*` Tauri commands. */
export type TrackerProvider = "trello" | "jira";

export type TrackerSettingField = {
  /** Repo setting suffix, stored as `${provider}_${key}`. */
  key: string;
  title: string;
  description: string;
  placeholder: string;
  secret?: boolean;
};

export type TrackerProviderConfig = {
  id: TrackerProvider;
  label: string;
  basePath: string;
  featureId: PreviewFeatureId;
  containerLabel: string;
  allContainersLabel: string | null;
  itemNoun: string;
  subItemNoun: string;
  settings: TrackerSettingField[];
};

const AUTO_KICKOFF_FIELD: TrackerSettingField = {
  key: "auto_kickoff_label",
  title: "Auto-kickoff label",
  description: "Open items with this label get a workspace automatically",
  placeholder: "e.g. ready-to-work",
};

export const TRACKER_PROVIDERS: Record<TrackerProvider, TrackerProviderConfig> =
  {
    trello: {
      id: "trello",
      label: "Trello",
      basePath: "/trello",
      featureId: "trelloIntegration",
      containerLabel: "Board",
      // Trello has no cross-board card listing; the backend falls back to
      // the first board when none is selected.
      allContainersLabel: null,
      itemNoun: "card",
      subItemNoun: "sub-items",
      settings: [
        {
          key: "api_key",
          title: "API key",
          description: "From your Trello Power-Up admin page",
          placeholder: "Trello API key",
          secret: true,
        },
        {
          key: "token",
          title: "Token",
          description: "User token authorized for the API key",
          placeholder: "Trello token",
          secret: true,
        },
        AUTO_KICKOFF_FIELD,
      ],
    },
    jira: {
      id: "jira",
      label: "Jira",
      basePath: "/jira",
      featureId: "jiraIntegration",
      containerLabel: "Project",
      allContainersLabel: "All projects",
      itemNoun: "issue",
      subItemNoun: "subtasks",
      settings: [
        {
          key: "base_url",
          title: "Site URL",
          description: "Your Jira Cloud site",
          placeholder: "acme.atlassian.net",
        },
        {
          key: "email",
          title: "Email",
          description: "Atlassian account email for the API token",
          placeholder: "you@example.com",
        },
        {
          key: "api_token",
          title: "API token",
          description: "Create one at id.atlassian.com",
          placeholder: "Atlassian API token",
          secret: true,
        },
        {
          key: "jql",
          title: "Issue query (JQL)",
          description: "Defaults to open issues assigned to or reported by you",
          placeholder: "statusCategory != Done ORDER BY updated DESC",
        },
        AUTO_KICKOFF_FIELD,
      ],
    },
  };

export const TRACKER_PROVIDER_IDS = Object.keys(
  TRACKER_PROVIDERS,
) as TrackerProvider[];

export const trackerSettingKey = (provider: TrackerProvider, key: string) =>
  `${provider}_${key}`;
