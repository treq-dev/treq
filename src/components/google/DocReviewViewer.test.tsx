import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "../../../test/test-utils";
import type { DriveFile } from "../../lib/api-google";
import type { AgentReviewComment } from "../../lib/api-types-review";
import { DocReviewViewer, placeFindings } from "./DocReviewViewer";

const api = vi.hoisted(() => ({
  deleteAgentReviewComment: vi.fn(),
  resolveAgentReviewComment: vi.fn(),
  googlePostReviewComments: vi.fn(),
  googleReadDocExport: vi.fn(),
}));

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  deleteAgentReviewComment: api.deleteAgentReviewComment,
  resolveAgentReviewComment: api.resolveAgentReviewComment,
}));
vi.mock("../../lib/api-google", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api-google")>()),
  googlePostReviewComments: api.googlePostReviewComments,
  googleReadDocExport: api.googleReadDocExport,
}));

const file: DriveFile = {
  id: "doc1",
  name: "Spec",
  mime_type: "application/vnd.google-apps.document",
  modified_time: null,
  web_view_link: "https://docs.google.com/doc1",
  owner: null,
  reviewable: true,
};

const finding = (overrides: Partial<AgentReviewComment> = {}) =>
  ({
    id: "c1",
    repo_path: "/repo",
    target_type: "google_doc",
    target_id: "doc1",
    file_path: "Spec.md",
    hunk_id: null,
    start_line: 2,
    end_line: 3,
    side: "new",
    comment_text: "This date contradicts section 2",
    suggested_replacement: "Shipped in May.",
    status: "open",
    source: "local-agent",
    created_at: "",
    resolved_at: null,
    ...overrides,
  }) as AgentReviewComment;

const onFindingsChanged = vi.fn(async () => {});
const onReview = vi.fn<(f: DriveFile) => Promise<void>>(async () => {});
const onClose = vi.fn();

const renderViewer = (findings = [finding()]) =>
  render(
    <DocReviewViewer
      file={file}
      repoPath="/repo"
      findings={findings}
      onFindingsChanged={onFindingsChanged}
      reviewDisabled={false}
      onReview={onReview}
      onClose={onClose}
    />,
  );

describe("DocReviewViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.googleReadDocExport.mockResolvedValue({
      file_name: "Spec.md",
      text: "Title\nShipped in April.\nSee section 2.\nEnd\n",
    });
    api.googlePostReviewComments.mockResolvedValue({ posted: 1, errors: [] });
    api.deleteAgentReviewComment.mockResolvedValue(undefined);
    api.resolveAgentReviewComment.mockResolvedValue(undefined);
  });

  it("shows each finding inline after the last line it covers", async () => {
    renderViewer();
    const lines = await screen.findByTestId("doc-review-lines");
    expect(api.googleReadDocExport).toHaveBeenCalledWith("/repo", "doc1");
    const inline = within(lines).getByTestId("agent-review-inline-list");
    expect(inline.previousElementSibling).toHaveAttribute("data-doc-line", "3");
    expect(inline).toHaveTextContent("This date contradicts section 2");
    // The suggestion diffs against the lines the finding covers.
    expect(
      within(inline).getAllByText(/Shipped in/).length,
    ).toBeGreaterThanOrEqual(2);
    // A Drive doc cannot be edited in place.
    expect(
      within(inline).queryByRole("button", { name: "Apply" }),
    ).not.toBeInTheDocument();
  });

  it("resolves and drops findings", async () => {
    renderViewer();
    await screen.findByTestId("doc-review-lines");
    await userEvent.click(screen.getByRole("button", { name: "Resolve" }));
    expect(api.resolveAgentReviewComment).toHaveBeenCalledWith("/repo", "c1");
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(api.deleteAgentReviewComment).toHaveBeenCalledWith("/repo", "c1");
    expect(onFindingsChanged).toHaveBeenCalled();
  });

  it("posts the findings to Drive", async () => {
    renderViewer();
    await userEvent.click(
      await screen.findByRole("button", { name: "Post 1 comment to Drive" }),
    );
    expect(api.googlePostReviewComments).toHaveBeenCalledWith("/repo", "doc1");
  });

  it("asks before a re-review discards unposted findings", async () => {
    renderViewer();
    await userEvent.click(
      await screen.findByRole("button", { name: "Re-review" }),
    );
    expect(onReview).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "discards the 1 unposted finding",
    );
    await userEvent.click(screen.getByRole("button", { name: "Review again" }));
    expect(onReview).toHaveBeenCalledWith(file);
  });

  it("prompts to run Review when there is no export", async () => {
    api.googleReadDocExport.mockRejectedValue("No export found");
    renderViewer([]);
    expect(
      await screen.findByText(/No review export for this document yet/),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(onReview).toHaveBeenCalledWith(file);
  });
});

describe("placeFindings", () => {
  it("clamps findings past the end onto the last line", () => {
    const placed = placeFindings(
      [finding({ id: "a", end_line: 9 }), finding({ id: "b", end_line: 1 })],
      4,
    );
    expect(placed.get(4)?.map((f) => f.id)).toEqual(["a"]);
    expect(placed.get(1)?.map((f) => f.id)).toEqual(["b"]);
  });
});
