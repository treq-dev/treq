import { invoke } from "@tauri-apps/api/core";
import type { TrackerProvider } from "./trackers";

export type { TrackerProvider } from "./trackers";

export type TrackerStatusCategory = "todo" | "in_progress" | "done";

export type TrackerUser = {
  id: string;
  name: string;
};

/** A Trello board or a Jira project. */
export type TrackerContainer = {
  id: string;
  name: string;
  key: string | null;
};

export type TrackerItem = {
  id: string;
  key: string;
  title: string;
  description: string | null;
  url: string;
  status: { name: string; category: TrackerStatusCategory };
  labels: string[];
  assignees: TrackerUser[];
  container: TrackerContainer | null;
  branch_name: string;
  parent_id: string | null;
  sub_item_ids: string[];
};

export type TrackerKickoffResult = {
  item_id: string;
  workspace_id: number;
  created: boolean;
};

export const trackerListContainers = (
  provider: TrackerProvider,
  repoPath: string,
): Promise<TrackerContainer[]> =>
  invoke("tracker_list_containers", { provider, repoPath });

export const trackerListItems = (
  provider: TrackerProvider,
  repoPath: string,
  containerId?: string,
): Promise<TrackerItem[]> =>
  invoke("tracker_list_items", { provider, repoPath, containerId });

export const trackerGetViewer = (
  provider: TrackerProvider,
  repoPath: string,
): Promise<TrackerUser> => invoke("tracker_get_viewer", { provider, repoPath });

/** Opens or creates the workspace for one item. Sub-items are separate calls. */
export const trackerOpenOrCreateWorkspaceFromItem = (
  repoPath: string,
  item: { provider: TrackerProvider; id: string },
): Promise<TrackerKickoffResult> =>
  invoke("tracker_open_or_create_workspace_from_item", {
    provider: item.provider,
    repoPath,
    itemId: item.id,
  });

export const trackerStartAutoKickoffPolling = (
  provider: TrackerProvider,
  repoPath: string,
): Promise<void> =>
  invoke("tracker_start_auto_kickoff_polling", { provider, repoPath });

/** Hands the Rust proxy clients (Linear, Google) the treq Supabase session. */
export const setProxySession = (
  supabaseUrl: string | null,
  accessToken: string | null,
): Promise<void> => invoke("set_proxy_session", { supabaseUrl, accessToken });
