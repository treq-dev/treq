import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "../../../test/test-utils";
import type { DriveFile } from "../../lib/api-google";
import { GoogleDrivePanel } from "./GoogleDrivePanel";

const api = vi.hoisted(() => ({
  googleListDriveFiles: vi.fn(),
  googleListDocFindings: vi.fn(),
  googlePrepareDocReview: vi.fn(),
  googleDiscardUnpostedFindings: vi.fn(),
  getRepoSetting: vi.fn(),
}));

vi.mock("../../lib/api-google", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api-google")>()),
  googleListDriveFiles: api.googleListDriveFiles,
  googleListDocFindings: api.googleListDocFindings,
  googlePrepareDocReview: api.googlePrepareDocReview,
  googleDiscardUnpostedFindings: api.googleDiscardUnpostedFindings,
}));
vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  getRepoSetting: api.getRepoSetting,
}));

const doc = (id: string, name: string): DriveFile => ({
  id,
  name,
  mime_type: "application/vnd.google-apps.document",
  modified_time: null,
  web_view_link: null,
  owner: null,
  reviewable: true,
});

const finding = (id: string, targetId: string) => ({
  id,
  repo_path: "/repo",
  target_type: "google_doc",
  target_id: targetId,
  file_path: "x.md",
  hunk_id: null,
  start_line: 1,
  end_line: 1,
  side: "new",
  comment_text: `finding ${id}`,
  suggested_replacement: null,
  status: "open",
  source: "local-agent",
  created_at: "",
  resolved_at: null,
});

describe("GoogleDrivePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.googleListDriveFiles.mockResolvedValue([
      doc("a", "Spec"),
      doc("b", "Plan"),
    ]);
    api.googleListDocFindings.mockResolvedValue([
      finding("1", "a"),
      finding("2", "a"),
      finding("3", "b"),
    ]);
    api.googlePrepareDocReview.mockResolvedValue({
      file: doc("a", "Spec"),
      root: "/exports/a",
      file_name: "Spec.md",
      line_count: 3,
    });
    api.googleDiscardUnpostedFindings.mockResolvedValue(undefined);
    api.getRepoSetting.mockResolvedValue(null);
  });

  it("fetches all findings once and shows each file its own", async () => {
    render(<GoogleDrivePanel repoPath="/repo" onStartReview={vi.fn()} />);
    const spec = await screen.findByTestId("drive-file-a");
    expect(await within(spec).findByText("2 findings")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("drive-file-b")).getByText("1 finding"),
    ).toBeInTheDocument();
    expect(api.googleListDocFindings).toHaveBeenCalledTimes(1);
    expect(api.googleListDocFindings).toHaveBeenCalledWith("/repo");
  });

  const reviewSpec = async () => {
    const spec = await screen.findByTestId("drive-file-a");
    await within(spec).findByText("2 findings");
    await userEvent.click(within(spec).getByRole("button", { name: "Review" }));
    await userEvent.click(
      within(spec).getByRole("button", { name: "Review again" }),
    );
  };

  it("discards old findings only after the review session launches", async () => {
    const order: string[] = [];
    api.googlePrepareDocReview.mockImplementation(async () => {
      order.push("prepare");
      return {
        file: doc("a", "Spec"),
        root: "/r",
        file_name: "Spec.md",
        line_count: 1,
        stale_finding_ids: ["old-1"],
      };
    });
    api.googleDiscardUnpostedFindings.mockImplementation(async () => {
      order.push("discard");
    });
    const onStartReview = vi.fn(async () => {
      order.push("launch");
    });
    render(<GoogleDrivePanel repoPath="/repo" onStartReview={onStartReview} />);
    await reviewSpec();
    await vi.waitFor(() =>
      expect(order).toEqual(["prepare", "launch", "discard"]),
    );
    // Only findings from before the export are discarded.
    expect(api.googleDiscardUnpostedFindings).toHaveBeenCalledWith(
      "/repo",
      "a",
      ["old-1"],
    );
  });

  it("keeps old findings when the launch fails", async () => {
    const onStartReview = vi.fn(async () => {
      throw new Error("no agent");
    });
    render(<GoogleDrivePanel repoPath="/repo" onStartReview={onStartReview} />);
    await reviewSpec();
    await vi.waitFor(() => expect(onStartReview).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(api.googleDiscardUnpostedFindings).not.toHaveBeenCalled();
  });
});
