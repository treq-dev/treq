import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "../../../test/test-utils";
import type { DriveFile } from "../../lib/api-google";
import { useToastStore } from "../../stores/toastStore";
import { DriveFileRow } from "./DriveFileRow";

const api = vi.hoisted(() => ({
  deleteAgentReviewComment: vi.fn(),
  googlePostReviewComments: vi.fn(),
}));

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
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

const onFindingsChanged = vi.fn(async () => {});

const row = (
  findings: (typeof finding)[],
  disabled: boolean,
  onReview: (f: DriveFile) => Promise<void>,
) => (
  <ul>
    <DriveFileRow
      file={file}
      repoPath="/repo"
      findings={findings as never}
      onFindingsChanged={onFindingsChanged}
      disabled={disabled}
      onReview={onReview}
    />
  </ul>
);

const renderRow = (
  onReview = vi.fn<(f: DriveFile) => Promise<void>>(async () => {}),
  disabled = false,
) => {
  const view = render(row([finding], disabled, onReview));
  return Object.assign(onReview, { view });
};

describe("DriveFileRow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.deleteAgentReviewComment.mockResolvedValue(undefined);
    api.googlePostReviewComments.mockResolvedValue({ posted: 1, errors: [] });
  });

  it("shows findings before they are posted, and posts them", async () => {
    renderRow();
    await userEvent.click(screen.getByText("1 finding"));
    expect(
      screen.getByText("This date contradicts section 2"),
    ).toBeInTheDocument();
    expect(screen.getByText("Lines 3–4")).toBeInTheDocument();
    await userEvent.click(screen.getByText(/Post 1 comment/));
    expect(api.googlePostReviewComments).toHaveBeenCalledWith("/repo", "doc1");
  });

  it("drops a finding", async () => {
    renderRow();
    await userEvent.click(screen.getByText("1 finding"));
    await userEvent.click(screen.getByLabelText("Drop finding"));
    expect(api.deleteAgentReviewComment).toHaveBeenCalledWith("/repo", "c1");
  });

  it("asks before a new review discards unposted findings", async () => {
    const onReview = renderRow();
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(onReview).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "discards the 1 unposted finding",
    );
    await userEvent.click(screen.getByRole("button", { name: "Review again" }));
    expect(onReview).toHaveBeenCalledWith(file);
  });

  it("asks again when the findings count changes", async () => {
    const onReview = renderRow();
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    onReview.view.rerender(
      row([finding, { ...finding, id: "c2" }], false, onReview),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("treats a finding already gone as dropped, and drops it once", async () => {
    let fail!: (e: unknown) => void;
    api.deleteAgentReviewComment.mockReturnValue(
      new Promise((_, reject) => {
        fail = reject;
      }),
    );
    renderRow();
    await userEvent.click(screen.getByText("1 finding"));
    const dropButton = screen.getByLabelText("Drop finding");
    await userEvent.click(dropButton);
    await userEvent.click(dropButton);
    expect(api.deleteAgentReviewComment).toHaveBeenCalledTimes(1);
    fail("Comment not found");
    await vi.waitFor(() => expect(onFindingsChanged).toHaveBeenCalled());
    expect(useToastStore.getState().toasts.map((t) => t.title)).not.toContain(
      "Failed to remove finding",
    );
  });

  it("disables Post and Drop while a review is preparing", async () => {
    renderRow(undefined, true);
    await userEvent.click(screen.getByText("1 finding"));
    expect(screen.getByLabelText("Drop finding")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /Post 1 comment/ }),
    ).toBeDisabled();
  });
});
