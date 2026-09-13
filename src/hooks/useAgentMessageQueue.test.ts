import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentMessageQueue } from "./useAgentMessageQueue";

describe("useAgentMessageQueue", () => {
  const write = vi.fn(async () => {});

  beforeEach(() => {
    write.mockReset();
    write.mockResolvedValue(undefined);
  });

  it("queues messages while busy and does not write yet", async () => {
    const { result } = renderHook(() =>
      useAgentMessageQueue({ ptySessionId: "pty-1", write }),
    );

    act(() => {
      result.current.enqueue("first");
      result.current.enqueue("second");
    });

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2);
    });
    expect(write).not.toHaveBeenCalled();
  });

  it("sends the oldest message with Enter when becoming idle", async () => {
    const { result } = renderHook(() =>
      useAgentMessageQueue({ ptySessionId: "pty-1", write }),
    );

    act(() => {
      result.current.enqueue("first");
      result.current.enqueue("second");
    });

    await waitFor(() => expect(result.current.messages).toHaveLength(2));

    act(() => {
      result.current.markIdle();
    });

    await waitFor(() => {
      expect(write).toHaveBeenCalledWith("pty-1", "first\r");
    });
    expect(result.current.messages.map((m) => m.text)).toEqual(["second"]);
    expect(result.current.isBusy).toBe(true);
  });

  it("sends immediately when enqueueing while idle", async () => {
    const { result } = renderHook(() =>
      useAgentMessageQueue({ ptySessionId: "pty-1", write }),
    );

    act(() => {
      result.current.markIdle();
    });

    act(() => {
      result.current.enqueue("hello");
    });

    await waitFor(() => {
      expect(write).toHaveBeenCalledWith("pty-1", "hello\r");
    });
    expect(result.current.messages).toHaveLength(0);
  });

  it("waits for the next idle before sending the next queued message", async () => {
    const { result } = renderHook(() =>
      useAgentMessageQueue({ ptySessionId: "pty-1", write }),
    );

    act(() => {
      result.current.enqueue("one");
      result.current.enqueue("two");
      result.current.markIdle();
    });

    await waitFor(() => {
      expect(write).toHaveBeenCalledTimes(1);
      expect(write).toHaveBeenCalledWith("pty-1", "one\r");
    });

    act(() => {
      result.current.markIdle();
    });

    await waitFor(() => {
      expect(write).toHaveBeenCalledTimes(2);
      expect(write).toHaveBeenLastCalledWith("pty-1", "two\r");
    });
  });

  it("removes and edits queued messages", async () => {
    const { result } = renderHook(() =>
      useAgentMessageQueue({ ptySessionId: "pty-1", write }),
    );

    act(() => {
      result.current.enqueue("keep");
      result.current.enqueue("drop");
    });

    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    const dropId = result.current.messages[1].id;
    const keepId = result.current.messages[0].id;

    act(() => {
      result.current.update(keepId, "kept-edited");
      result.current.remove(dropId);
    });

    expect(result.current.messages).toEqual([
      expect.objectContaining({ id: keepId, text: "kept-edited" }),
    ]);
  });

  it("does not send queued messages when idle on a user question", async () => {
    const { result } = renderHook(() =>
      useAgentMessageQueue({ ptySessionId: "pty-1", write }),
    );

    act(() => {
      result.current.enqueue("follow-up");
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    act(() => {
      result.current.markIdle({ awaitingQuestion: true });
    });

    await waitFor(() => expect(result.current.isBusy).toBe(false));
    expect(write).not.toHaveBeenCalled();
    expect(result.current.messages.map((m) => m.text)).toEqual(["follow-up"]);
  });

  it("does not send immediately when enqueueing while idle on a question", async () => {
    const { result } = renderHook(() =>
      useAgentMessageQueue({ ptySessionId: "pty-1", write }),
    );

    act(() => {
      result.current.markIdle({ awaitingQuestion: true });
    });

    act(() => {
      result.current.enqueue("do not send yet");
    });

    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(write).not.toHaveBeenCalled();
  });

  it("does not send queued text after the agent has returned to a shell", async () => {
    const { result } = renderHook(() =>
      useAgentMessageQueue({ ptySessionId: "pty-1", write }),
    );

    act(() => {
      result.current.enqueue("text with ' quotes and $(substitutions)");
      result.current.markIdle({ shellPrompt: true });
    });

    await waitFor(() => expect(result.current.isBusy).toBe(false));
    expect(write).not.toHaveBeenCalled();
    expect(result.current.messages).toHaveLength(1);
  });

  it("sends after a later idle that is not a user question", async () => {
    const { result } = renderHook(() =>
      useAgentMessageQueue({ ptySessionId: "pty-1", write }),
    );

    act(() => {
      result.current.enqueue("after-answer");
      result.current.markIdle({ awaitingQuestion: true });
    });

    await waitFor(() => expect(result.current.isBusy).toBe(false));
    expect(write).not.toHaveBeenCalled();

    act(() => {
      result.current.markBusy();
      result.current.markIdle();
    });

    await waitFor(() => {
      expect(write).toHaveBeenCalledWith("pty-1", "after-answer\r");
    });
  });

  it("requeues the message at the front when write fails", async () => {
    write.mockRejectedValueOnce(new Error("pty down"));
    const { result } = renderHook(() =>
      useAgentMessageQueue({ ptySessionId: "pty-1", write }),
    );

    act(() => {
      result.current.enqueue("retry-me");
      result.current.markIdle();
    });

    await waitFor(() => {
      expect(write).toHaveBeenCalled();
      expect(result.current.messages[0]?.text).toBe("retry-me");
      expect(result.current.isBusy).toBe(false);
    });
  });
});
