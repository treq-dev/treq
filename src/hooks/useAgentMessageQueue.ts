import { useEffect, useRef, useState } from "react";
import { ptyWrite } from "../lib/api";
import {
  type QueuedAgentMessage,
  dequeueOldestAgentMessage,
  enqueueAgentMessage,
  formatAgentMessageForPty,
  removeAgentMessage,
  updateAgentMessage,
} from "../lib/agentMessageQueue";

export interface UseAgentMessageQueueOptions {
  ptySessionId: string;
  /** Optional write override for tests. Defaults to ptyWrite. */
  write?: (sessionId: string, data: string) => Promise<void>;
}

export interface UseAgentMessageQueueResult {
  messages: QueuedAgentMessage[];
  isBusy: boolean;
  enqueue: (text: string) => void;
  remove: (id: string) => void;
  update: (id: string, text: string) => void;
  /** Mark the agent as producing output (busy). */
  markBusy: () => void;
  /** Mark the agent idle and flush the oldest queued message if any. */
  markIdle: (options?: { awaitingQuestion?: boolean }) => void;
  clear: () => void;
}

/**
 * Per-agent-terminal message queue. Messages sit until the agent is idle
 * and not waiting on a user question (permission / confirmation prompt),
 * then the oldest is written to the PTY as typed text + Enter.
 */
export function useAgentMessageQueue({
  ptySessionId,
  write = ptyWrite,
}: UseAgentMessageQueueOptions): UseAgentMessageQueueResult {
  const [messages, setMessages] = useState<QueuedAgentMessage[]>([]);
  const [isBusy, setIsBusy] = useState(true);
  const messagesRef = useRef(messages);
  const isBusyRef = useRef(isBusy);
  const flushingRef = useRef(false);
  const awaitingQuestionRef = useRef(false);
  const writeRef = useRef(write);
  const ptySessionIdRef = useRef(ptySessionId);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    isBusyRef.current = isBusy;
  }, [isBusy]);

  useEffect(() => {
    writeRef.current = write;
  }, [write]);

  useEffect(() => {
    ptySessionIdRef.current = ptySessionId;
  }, [ptySessionId]);

  const flushOldest = async () => {
    if (
      flushingRef.current ||
      isBusyRef.current ||
      awaitingQuestionRef.current
    ) {
      return;
    }
    const dequeued = dequeueOldestAgentMessage(messagesRef.current);
    if (!dequeued) return;

    flushingRef.current = true;
    setIsBusy(true);
    isBusyRef.current = true;
    setMessages(dequeued.remaining);
    messagesRef.current = dequeued.remaining;

    try {
      await writeRef.current(
        ptySessionIdRef.current,
        formatAgentMessageForPty(dequeued.message.text),
      );
    } catch (error) {
      // Put the message back at the front so it isn't lost on write failure.
      setMessages((prev) => {
        const next = [dequeued.message, ...prev];
        messagesRef.current = next;
        return next;
      });
      // Intentional: restore idle so the user can retry / next idle pulse retries.
      // eslint-disable-next-line require-atomic-updates -- sole writer of isBusyRef during flush
      isBusyRef.current = false;
      setIsBusy(false);
      console.error("Failed to send queued agent message:", error);
    } finally {
      // eslint-disable-next-line require-atomic-updates -- sole writer of flushingRef during flush
      flushingRef.current = false;
    }
  };

  const enqueue = (text: string) => {
    const next = enqueueAgentMessage(messagesRef.current, text);
    if (next === messagesRef.current) return;
    messagesRef.current = next;
    setMessages(next);
    queueMicrotask(() => {
      void flushOldest();
    });
  };

  const remove = (id: string) => {
    const next = removeAgentMessage(messagesRef.current, id);
    messagesRef.current = next;
    setMessages(next);
  };

  const update = (id: string, text: string) => {
    const next = updateAgentMessage(messagesRef.current, id, text);
    messagesRef.current = next;
    setMessages(next);
  };

  const markBusy = () => {
    awaitingQuestionRef.current = false;
    setIsBusy(true);
    isBusyRef.current = true;
  };

  const markIdle = (options?: { awaitingQuestion?: boolean }) => {
    awaitingQuestionRef.current = options?.awaitingQuestion === true;
    setIsBusy(false);
    isBusyRef.current = false;
    void flushOldest();
  };

  const clear = () => {
    setMessages([]);
    messagesRef.current = [];
  };

  return {
    messages,
    isBusy,
    enqueue,
    remove,
    update,
    markBusy,
    markIdle,
    clear,
  };
}
