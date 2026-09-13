import { describe, expect, it } from "vitest";
import {
  createQueuedAgentMessage,
  dequeueOldestAgentMessage,
  enqueueAgentMessage,
  formatAgentMessageForPty,
  looksLikeAgentUserQuestion,
  looksLikeShellPrompt,
  removeAgentMessage,
  updateAgentMessage,
} from "./agentMessageQueue";

describe("agentMessageQueue", () => {
  it("enqueues trimmed messages in FIFO order", () => {
    let queue = enqueueAgentMessage([], "  first  ", "a");
    queue = enqueueAgentMessage(queue, "second", "b");
    expect(queue).toEqual([
      createQueuedAgentMessage("first", "a", queue[0].createdAt),
      createQueuedAgentMessage("second", "b", queue[1].createdAt),
    ]);
  });

  it("ignores empty enqueue text", () => {
    expect(enqueueAgentMessage([], "   ")).toEqual([]);
  });

  it("removes a message by id", () => {
    const queue = enqueueAgentMessage(
      enqueueAgentMessage([], "keep", "keep"),
      "drop",
      "drop",
    );
    expect(removeAgentMessage(queue, "drop").map((m) => m.id)).toEqual([
      "keep",
    ]);
  });

  it("updates message text while queued", () => {
    const queue = enqueueAgentMessage([], "old", "m1");
    expect(updateAgentMessage(queue, "m1", "  new text  ")[0].text).toBe(
      "new text",
    );
  });

  it("ignores empty update text", () => {
    const queue = enqueueAgentMessage([], "keep", "m1");
    expect(updateAgentMessage(queue, "m1", "   ")[0].text).toBe("keep");
  });

  it("dequeues the oldest message first", () => {
    const queue = enqueueAgentMessage(
      enqueueAgentMessage([], "oldest", "1"),
      "newest",
      "2",
    );
    const result = dequeueOldestAgentMessage(queue);
    expect(result?.message.id).toBe("1");
    expect(result?.remaining.map((m) => m.id)).toEqual(["2"]);
  });

  it("returns null when dequeuing an empty queue", () => {
    expect(dequeueOldestAgentMessage([])).toBeNull();
  });

  it("formats message for pty as text plus carriage return", () => {
    expect(formatAgentMessageForPty("hello")).toBe("hello\r");
  });
});

describe("looksLikeShellPrompt", () => {
  it("detects the zsh prompt shown after an agent process exits", () => {
    expect(looksLikeShellPrompt("projects/treq [main] » ")).toBe(true);
  });

  it("detects an unterminated zsh parser continuation prompt", () => {
    expect(looksLikeShellPrompt("subsh quote> ")).toBe(true);
  });

  it("does not mistake ordinary agent output for a shell prompt", () => {
    expect(looksLikeShellPrompt("Tests 1 failed | 321 passed (322)\n")).toBe(
      false,
    );
  });
});

describe("looksLikeAgentUserQuestion", () => {
  it("detects a permission prompt that ends with a question mark", () => {
    const output = [
      "Claude wants to run:",
      "  npm test",
      "",
      "Would you like to run the following command?",
      "❯ 1. Yes",
      "  2. No, and tell Claude what to do differently",
    ].join("\n");
    expect(looksLikeAgentUserQuestion(output)).toBe(true);
  });

  it("detects a question mark wrapped in ANSI codes", () => {
    const output = "\x1b[1mAllow this action?\x1b[0m\r\n❯ Yes";
    expect(looksLikeAgentUserQuestion(output)).toBe(true);
  });

  it("returns false for idle agent output without a question", () => {
    const output = [
      "I'll add the tests next.",
      "Done. The suite is green.",
    ].join("\n");
    expect(looksLikeAgentUserQuestion(output)).toBe(false);
  });

  it("ignores a question mark buried above the recent tail", () => {
    const olderQuestion = "What should I do next?\n";
    const work = `${"running tests\n".repeat(20)}All tests passed.\n`;
    expect(looksLikeAgentUserQuestion(`${olderQuestion}${work}`)).toBe(false);
  });
});
