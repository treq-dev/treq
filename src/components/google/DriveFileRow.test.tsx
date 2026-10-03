import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "../../../test/test-utils";
import type { DriveFile } from "../../lib/api-google";
import { DriveFileRow } from "./DriveFileRow";

const api = vi.hoisted(() => ({
  listAgentReviewComments: vi.fn(),
  deleteAgentReviewComment: vi.fn(),
  googlePostReviewComments: vi.fn(),
}));

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  listAgentReviewComments: api.listAgentReviewComments,
  deleteAgentReviewComment: api.deleteAgentReviewComment,
}));
vi.mock("../../lib/api-google", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api-google")>()),
  googlePostReviewComments: api.googlePostReviewComments,
}));

const file: DriveFile = {
  id: "doc1",
  name: "Spec",
  mime_type: "application/vnd.google-apps.document",
  modified_time: null,
  web_view_link: null,
  owner: null,
  reviewable: true,
};

const finding = {
  id: "c1",
  repo_path: "/repo",
  target_type: "google_doc",
  target_id: "doc1",
  file_path: "Spec.md",
  hunk_id: null,
  start_line: 3,
  end_line: 4,
  side: "new",
  comment_text: "This date contradicts section 2",
  suggested_replacement: null,
  status: "open",
  source: "local-agent",
  created_at: "",
  resolved_at: null,
};

const renderRow = (onReview = vi.fn(async () => {})) => {
  render(
    <ul>
      <DriveFileRow
        file={file}
        repoPath="/repo"
        disabled={false}
        onReview={onReview}
      />
    </ul>,
  );
  return onReview;
};

describe("DriveFileRow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listAgentReviewComments.mockResolvedValue([finding]);
    api.googlePostReviewComments.mockResolvedValue({ posted: 1, errors: [] });
  });

  it("shows findings before they are posted, and posts them", async () => {
    renderRow();
    await userEvent.click(await screen.findByText("1 finding"));
    expect(
      screen.getByText("This date contradicts section 2"),
    ).toBeInTheDocument();
    expect(screen.getByText("Lines 3–4")).toBeInTheDocument();
    await userEvent.click(screen.getByText(/Post 1 comment/));
    expect(api.googlePostReviewComments).toHaveBeenCalledWith("/repo", "doc1");
  });

  it("drops a finding", async () => {
    renderRow();
    await userEvent.click(await screen.findByText("1 finding"));
    await userEvent.click(screen.getByLabelText("Drop finding"));
    expect(api.deleteAgentReviewComment).toHaveBeenCalledWith("/repo", "c1");
  });

  it("asks before a new review discards unposted findings", async () => {
    const onReview = renderRow();
    await screen.findByText("1 finding");
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(onReview).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "discards the 1 unposted finding",
    );
    await userEvent.click(screen.getByRole("button", { name: "Review again" }));
    expect(onReview).toHaveBeenCalledWith(file);
  });
});
