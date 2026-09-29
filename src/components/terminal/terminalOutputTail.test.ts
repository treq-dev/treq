import { describe, expect, it } from "vitest";
import {
  appendTerminalOutput,
  createTerminalOutputTail,
  terminalQuestionWindow,
} from "./terminalOutputTail";

describe("terminal output tail", () => {
  it("retains at most 32 KiB from a multi-megabyte stream", () => {
    let tail = createTerminalOutputTail();
    for (let i = 0; i < 2048; i += 1) {
      tail = appendTerminalOutput(tail, `${i}:`.padEnd(1024, "x"));
    }
    expect(tail.raw.length).toBeLessThanOrEqual(32 * 1024);
    expect(tail.raw).toContain("2047:");
  });

  it("uses only the newest fifteen meaningful lines for questions", () => {
    let tail = createTerminalOutputTail();
    tail = appendTerminalOutput(tail, "Do you want to continue?\n");
    tail = appendTerminalOutput(
      tail,
      Array.from({ length: 15 }, (_, index) => `work ${index}`).join("\n"),
    );
    expect(terminalQuestionWindow(tail)).not.toContain("continue?");
  });
});
