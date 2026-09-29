import { describe, expect, it } from "vitest";
import { normalizeCommand } from "./normalizeCommand";

describe("normalizeCommand", () => {
  it("ends the command with a single Enter keypress", () => {
    expect(normalizeCommand("claude -- 'hi'")).toBe("claude -- 'hi'\r");
  });

  it("replaces any trailing line ending with one Enter", () => {
    expect(normalizeCommand("codex\n")).toBe("codex\r");
    expect(normalizeCommand("codex\r\n")).toBe("codex\r");
  });

  it("keeps line breaks inside a multi-line prompt", () => {
    expect(normalizeCommand("claude -- 'a\n\nb'")).toBe("claude -- 'a\n\nb'\r");
  });
});
