import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen } from "../../../test/test-utils";
import { MobileConflictView } from "./MobileConflictView";
import * as api from "../../lib/api";
import { createMockWorkspaceStatus } from "../../../test/factories/workspace.factory";

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual("../../lib/api");
  return {
    ...actual,
    getWorkspaceStatus: vi.fn(),
    getWorkspaceDiff: vi.fn(),
    getWorkspaceFileHunks: vi.fn(),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MobileConflictView", () => {
  it("reads conflict regions from getWorkspaceDiff's committed hunks_by_file, not getWorkspaceFileHunks", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getWorkspaceStatus).mockResolvedValue(
      createMockWorkspaceStatus({ conflicted_files: ["README.md"] }),
    );
    vi.mocked(api.getWorkspaceDiff).mockResolvedValue({
      committed_files: [
        {
          path: "README.md",
          status: "M",
          previous_path: null,
          changed_line_count: 7,
          diff_deferred: false,
        },
      ],
      hunks_by_file: [
        {
          path: "README.md",
          hunks: [
            {
              id: "h1",
              header: "",
              lines: [],
              patch: "",
              conflict_regions: [
                {
                  id: "README.md-conflict-1",
                  file_path: "README.md",
                  conflict_number: 1,
                  total_conflicts: 1,
                  start_line: 1,
                  end_line: 3,
                  content: "",
                  marker_style: "git_diff3",
                  lines: [
                    {
                      raw: "main side",
                      kind: "content",
                      role: "left",
                      file_line: 1,
                    },
                  ],
                  line_map: [1],
                  comparison: {
                    left_line_indexes: [0],
                    base_line_indexes: [],
                    right_line_indexes: [],
                  },
                },
              ],
            },
          ],
        },
      ],
      uncommitted_files: [],
      conflicted_files: ["README.md"],
      too_large_to_render: false,
    });

    render(<MobileConflictView repoPath="/repo" workspaceId={1} />);

    await user.click(await screen.findByText("README.md"));
    expect(await screen.findByText("Conflict 1 of 1")).toBeInTheDocument();
    expect(screen.getByText("main side")).toBeInTheDocument();
    expect(api.getWorkspaceFileHunks).not.toHaveBeenCalled();
  });
});
