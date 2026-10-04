import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import type { GoogleTaskCompletedEvent } from "../lib/api-google";
import type { Workspace } from "../lib/api-types";
import { linkedTaskTitle } from "../lib/google-tasks";
import { invalidateQueries } from "../lib/swr-cache";
import { useToastStore } from "../stores/toastStore";

export const GOOGLE_TASK_COMPLETED_EVENT = "google-task-completed";

/**
 * The backend completes a workspace's linked Google Task when the workspace
 * merges. Tell the user, and refetch that task list and the workspaces whose
 * metadata now records the completion.
 */
export function useGoogleTaskCompletedToasts(workspaces: Workspace[]) {
  const latest = useRef(workspaces);
  latest.current = workspaces;
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<GoogleTaskCompletedEvent>(
      GOOGLE_TASK_COMPLETED_EVENT,
      ({ payload }) => {
        const workspace = latest.current.find(
          (w) => w.id === payload.workspace_id,
        );
        const title = (workspace && linkedTaskTitle(workspace)) || "the task";
        useToastStore.getState().addToast({
          title: `Marked '${title}' complete in Google Tasks`,
          type: "success",
        });
        void invalidateQueries(["google-tasks", payload.list_id]);
        void invalidateQueries(["workspaces"]);
      },
    ).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
