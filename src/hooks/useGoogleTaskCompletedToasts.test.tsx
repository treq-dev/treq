import { listen } from "@tauri-apps/api/event";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "../lib/api-types";
import { useToastStore } from "../stores/toastStore";
import {
  GOOGLE_TASK_COMPLETED_EVENT,
  useGoogleTaskCompletedToasts,
} from "./useGoogleTaskCompletedToasts";

const swr = vi.hoisted(() => ({ invalidateQueries: vi.fn() }));
vi.mock("../lib/swr-cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/swr-cache")>()),
  ...swr,
}));

describe("useGoogleTaskCompletedToasts", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    swr.invalidateQueries.mockClear();
  });

  it("toasts the task title and refetches its list and workspaces", async () => {
    let handler: ((e: { payload: unknown }) => void) | undefined;
    vi.mocked(listen).mockImplementationOnce(async (event, fn) => {
      expect(event).toBe(GOOGLE_TASK_COMPLETED_EVENT);
      handler = fn as typeof handler;
      return () => undefined;
    });
    const workspace = {
      id: 3,
      metadata: JSON.stringify({ google_task_title: "Write spec" }),
    } as Workspace;
    renderHook(() => useGoogleTaskCompletedToasts([workspace]));
    await waitFor(() => expect(handler).toBeDefined());
    handler!({
      payload: {
        repo_path: "/repo",
        workspace_id: 3,
        list_id: "inbox",
        task_id: "t1",
      },
    });
    expect(useToastStore.getState().toasts.map((t) => t.title)).toEqual([
      "Marked 'Write spec' complete in Google Tasks",
    ]);
    expect(swr.invalidateQueries).toHaveBeenCalledWith([
      "google-tasks",
      "inbox",
    ]);
    expect(swr.invalidateQueries).toHaveBeenCalledWith(["workspaces"]);
  });
});
