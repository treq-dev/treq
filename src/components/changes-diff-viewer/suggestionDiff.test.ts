import { describe, expect, it } from "vitest";
import { buildSuggestionDiff, type SuggestionDiffRow } from "./suggestionDiff";

describe("buildSuggestionDiff", () => {
  it("returns null without original text to diff against", () => {
    expect(buildSuggestionDiff(undefined, "const a = 1;")).toBeNull();
    expect(buildSuggestionDiff(null, "const a = 1;")).toBeNull();
    expect(buildSuggestionDiff("", "const a = 1;")).toBeNull();
  });

  it("returns null when the suggestion changes nothing", () => {
    expect(buildSuggestionDiff("const a = 1;", "const a = 1;")).toBeNull();
  });

  it("highlights only the changed words of a one-word edit", () => {
    const rows = buildSuggestionDiff("const a = 1;", "const a = 2;");
    expect(rows?.map((row) => row.type)).toEqual(["removed", "added"]);
    const changedText = (row: SuggestionDiffRow) =>
      row.segments
        .filter((segment) => segment.changed)
        .map((segment) => segment.text)
        .join("");
    expect(rows?.map(changedText)).toEqual(["1", "2"]);
  });

  it("keeps untouched lines as unchanged rows", () => {
    const rows = buildSuggestionDiff(
      "line one\nline two\nline three",
      "line one\nline TWO\nline three",
    );
    expect(rows?.map((row) => row.type)).toEqual([
      "unchanged",
      "removed",
      "added",
      "unchanged",
    ]);
  });

  it("falls back to whole-line rows when the line is rewritten", () => {
    const rows = buildSuggestionDiff("abcdef", "zyxwvu");
    expect(rows?.map((row) => row.type)).toEqual(["removed", "added"]);
    expect(rows?.[0].segments).toHaveLength(1);
    expect(rows?.[0].segments[0].changed).toBe(true);
  });

  it("renders a pure insertion as added rows only", () => {
    const rows = buildSuggestionDiff("a\nb", "a\nnew\nb");
    expect(rows?.map((row) => row.type)).toEqual([
      "unchanged",
      "added",
      "unchanged",
    ]);
  });
});
