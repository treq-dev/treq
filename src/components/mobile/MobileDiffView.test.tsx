import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen } from "../../../test/test-utils";
import { MobileDiffView } from "./MobileDiffView";
import * as api from "../../lib/api";

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual("../../lib/api");
  return {
    ...actual,
    getWorkspaceDiff: vi.fn(),
    getWorkspaceFileHunksBatch: vi.fn(),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MobileDiffView", () => {
  it("fetches hunks for uncommitted files separately, since getWorkspaceDiff's hunks_by_file only covers committed_files", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getWorkspaceDiff).mockResolvedValue({
      committed_files: [],
      hunks_by_file: [],
      uncommitted_files: [
        {
          path: "notes.txt",
          status: "A",
          previous_path: null,
          changed_line_count: 1,
          diff_deferred: false,
        },
      ],
      conflicted_files: [],
      too_large_to_render: false,
    });
    vi.mocked(api.getWorkspaceFileHunksBatch).mockResolvedValue({
      snapshotToken: "snap",
      files: [
        {
          path: "notes.txt",
          contentHash: "hash",
          hunks: [
            {
              id: "h1",
              header: "@@ -0,0 +1,1 @@",
              lines: ["+a fresh note"],
              patch: "",
            },
          ],
        },
      ],
    });

    render(<MobileDiffView repoPath="/repo" workspaceId={1} />);

    await user.click(await screen.findByText("notes.txt"));
    expect(await screen.findByText("+a fresh note")).toBeInTheDocument();
    expect(api.getWorkspaceFileHunksBatch).toHaveBeenCalledWith("/repo", 1, [
      "notes.txt",
    ]);
  });
});
