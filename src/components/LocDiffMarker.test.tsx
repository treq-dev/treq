import { describe, expect, it } from "vitest";
import { render, screen } from "../../test/test-utils";
import { LocDiffMarker } from "./LocDiffMarker";

describe("LocDiffMarker", () => {
  it("renders nothing when both insertions and deletions are zero", () => {
    render(<LocDiffMarker diffStats={{ insertions: 0, deletions: 0 }} />);
    expect(screen.queryByTestId("loc-diff-marker")).toBeNull();
  });

  it("renders Gerrit-style +N / -N counts", () => {
    render(<LocDiffMarker diffStats={{ insertions: 10, deletions: 6 }} />);
    const marker = screen.getByTestId("loc-diff-marker");
    expect(marker.textContent).toContain("+10");
    expect(marker.textContent).toContain("-6");
  });
});
