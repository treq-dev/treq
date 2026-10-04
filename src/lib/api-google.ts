import { invoke } from "@tauri-apps/api/core";
import type { AgentReviewComment } from "./api-types-review";

export type GoogleConnectionStatus = {
  /** `local` (own OAuth client), `proxy` (treq Pro) or `none`. */
  mode: "local" | "proxy" | "none";
};

export type GoogleTaskList = { id: string; title: string };

export type GoogleTask = {
  id: string;
  list_id: string;
  title: string;
  notes: string | null;
  status: "needsAction" | "completed";
  due: string | null;
  parent: string | null;
  position: string;
  web_link: string | null;
};

export type GoogleTaskInput = {
  title?: string;
  notes?: string;
  status?: "needsAction" | "completed";
  /** RFC 3339; empty string clears the due date. */
  due?: string;
  /** On creation only: the task this one becomes a subtask of. */
  parent?: string;
};

export type DriveFile = {
  id: string;
  name: string;
  mime_type: string;
  modified_time: string | null;
  web_view_link: string | null;
  owner: string | null;
  reviewable: boolean;
};

export type PreparedDocReview = {
  file: DriveFile;
  root: string;
  file_name: string;
  line_count: number;
};

/** Agent review comments on an exported Drive file use this target type. */
export const GOOGLE_DOC_REVIEW_TARGET = "google_doc";

export const googleConnectionStatus = (): Promise<GoogleConnectionStatus> =>
  invoke("google_connection_status");

export const googleOAuthBegin = (
  clientId: string,
  clientSecret?: string,
): Promise<string> => invoke("google_oauth_begin", { clientId, clientSecret });

/** Stops a pending local sign-in; `googleOAuthComplete` then rejects. */
export const googleOAuthCancel = (): Promise<void> =>
  invoke("google_oauth_cancel");

export const googleOAuthComplete = (): Promise<void> =>
  invoke("google_oauth_complete");

export const googleDisconnectLocal = (): Promise<void> =>
  invoke("google_disconnect_local");

export const googleListTaskLists = (): Promise<GoogleTaskList[]> =>
  invoke("google_list_task_lists");

export const googleCreateTaskList = (title: string): Promise<GoogleTaskList> =>
  invoke("google_create_task_list", { title });

export const googleListTasks = (listId: string): Promise<GoogleTask[]> =>
  invoke("google_list_tasks", { listId });

export const googleCreateTask = (
  listId: string,
  input: GoogleTaskInput,
): Promise<GoogleTask> => invoke("google_create_task", { listId, input });

export const googleUpdateTask = (
  listId: string,
  taskId: string,
  input: GoogleTaskInput,
): Promise<GoogleTask> =>
  invoke("google_update_task", { listId, taskId, input });

export const googleDeleteTask = (
  listId: string,
  taskId: string,
): Promise<void> => invoke("google_delete_task", { listId, taskId });

export const googleMoveTask = (move: {
  listId: string;
  taskId: string;
  /** Kanban column (task list) to move into; omit to stay in the list. */
  destinationListId?: string;
  /** Sibling to place the task after; omit for the top of the list. */
  previousTaskId?: string;
  /** Task to nest under; omit to move to the top level. */
  parent?: string;
}): Promise<MoveTaskResult> => invoke("google_move_task", move);

export type MoveTaskResult = {
  task: GoogleTask;
  /** Subtasks a cross-list move could not bring along. */
  failed_subtask_ids: string[];
};

export const googleListDriveFiles = (
  search: string | undefined,
  docsOnly: boolean,
): Promise<DriveFile[]> =>
  invoke("google_list_drive_files", { search, docsOnly });

export const googlePrepareDocReview = (
  repoPath: string,
  fileId: string,
): Promise<PreparedDocReview> =>
  invoke("google_prepare_doc_review", { repoPath, fileId });

export type PostCommentsResult = {
  posted: number;
  /** One message per comment that was not posted; those stay open. */
  errors: string[];
};

export const googlePostReviewComments = (
  repoPath: string,
  fileId: string,
): Promise<PostCommentsResult> =>
  invoke("google_post_review_comments", { repoPath, fileId });

/**
 * Drops a file's unposted findings. Call it only once the new review session
 * has started, so a failed launch keeps the old findings.
 */
export const googleDiscardUnpostedFindings = (
  repoPath: string,
  fileId: string,
): Promise<void> =>
  invoke("google_discard_unposted_findings", { repoPath, fileId });

/** Every open Google doc finding in the repository, for all files at once. */
export const googleListDocFindings = (
  repoPath: string,
): Promise<AgentReviewComment[]> =>
  invoke("google_list_doc_findings", { repoPath });
