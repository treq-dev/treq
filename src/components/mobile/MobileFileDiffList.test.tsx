import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen } from "../../../test/test-utils";
import { MobileFileDiffList } from "./MobileFileDiffList";
import type { JjFileChange, JjFileDiff } from "../../lib/api";

const files: JjFileChange[] = [
  {
    path: "src/foo.ts",
    status: "M",
    previous_path: null,
    changed_line_count: 2,
    diff_deferred: false,
  },
];

const hunksByFile: JjFileDiff[] = [
  {
    path: "src/foo.ts",
    hunks: [
      {
        id: "hunk-1",
        header: "@@ -1,2 +1,2 @@",
        lines: ["-old line", "+new line"],
        patch: "",
      },
    ],
  },
];

describe("MobileFileDiffList", () => {
  it("shows the empty label when there are no files", () => {
    render(
      <MobileFileDiffList
        files={[]}
        hunksByFile={[]}
        emptyLabel="Nothing changed."
      />,
    );

    expect(screen.getByText("Nothing changed.")).toBeInTheDocument();
  });

  it("expands a file to reveal its hunk on tap", async () => {
    const user = userEvent.setup();
    render(
      <MobileFileDiffList
        files={files}
        hunksByFile={hunksByFile}
        emptyLabel="Nothing changed."
      />,
    );

    expect(screen.queryByText("-old line")).not.toBeInTheDocument();

    await user.click(screen.getByText("src/foo.ts"));

    expect(screen.getByText("-old line")).toBeInTheDocument();
    expect(screen.getByText("+new line")).toBeInTheDocument();
  });
});
