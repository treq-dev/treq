import { openUrl } from "@tauri-apps/plugin-opener";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "../../../test/test-utils";
import { useFeaturePreviewStore } from "../../stores/featurePreviewStore";
import { WorkspaceTrackerBadges } from "./WorkspaceTrackerBadges";

describe("WorkspaceTrackerBadges", () => {
  beforeEach(() => {
    useFeaturePreviewStore.setState((s) => ({
      flags: { ...s.flags, googleWorkspace: true },
    }));
  });

  it("links to the workspace's Google Task", async () => {
    render(
      <WorkspaceTrackerBadges
        metadata={{
          google_task_id: "t1",
          google_tasklist_id: "l1",
          google_task_title: "Write spec",
          google_task_url: "https://tasks.google.com/t1",
        }}
      />,
    );
    const badge = screen.getByTestId("google-task-badge");
    expect(badge).toHaveTextContent("Write spec");
    expect(badge).toHaveAttribute("data-completed", "false");
    await userEvent.click(badge);
    expect(openUrl).toHaveBeenCalledWith("https://tasks.google.com/t1");
  });

  it("shows a completed Google Task", () => {
    render(
      <WorkspaceTrackerBadges
        metadata={{
          google_task_id: "t1",
          google_task_title: "Write spec",
          google_task_completed: true,
        }}
      />,
    );
    expect(screen.getByTestId("google-task-badge")).toHaveAttribute(
      "data-completed",
      "true",
    );
  });
});
