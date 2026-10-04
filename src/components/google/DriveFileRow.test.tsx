import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "../../../test/test-utils";
import type { DriveFile } from "../../lib/api-google";
import { DriveFileRow } from "./DriveFileRow";

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
const onOpenReview = vi.fn();

const row = (
  findings: (typeof finding)[],
  disabled: boolean,
  onReview: (f: DriveFile) => Promise<void>,
) => (
  <ul>
    <DriveFileRow
      file={file}
      findings={findings as never}
      onFindingsChanged={onFindingsChanged}
      disabled={disabled}
      onReview={onReview}
      onOpenReview={onOpenReview}
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
  });

  it("opens the review viewer from the findings count", async () => {
    renderRow();
    await userEvent.click(screen.getByRole("button", { name: "1 finding" }));
    expect(onOpenReview).toHaveBeenCalledWith(file);
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
});
