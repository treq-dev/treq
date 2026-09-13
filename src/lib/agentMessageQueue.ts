export interface QueuedAgentMessage {
  id: string;
  text: string;
  createdAt: number;
}

export function createQueuedAgentMessage(
  text: string,
  id: string = crypto.randomUUID(),
  createdAt: number = Date.now(),
): QueuedAgentMessage {
  return { id, text, createdAt };
}

/** Append a message to the end of the queue (FIFO). */
export function enqueueAgentMessage(
  queue: QueuedAgentMessage[],
  text: string,
  id?: string,
): QueuedAgentMessage[] {
  const trimmed = text.trim();
  if (!trimmed) return queue;
  return [...queue, createQueuedAgentMessage(trimmed, id)];
}

/** Remove a message by id. */
export function removeAgentMessage(
  queue: QueuedAgentMessage[],
  id: string,
): QueuedAgentMessage[] {
  return queue.filter((message) => message.id !== id);
}

/** Update a message's text in place. Empty/whitespace text is ignored. */
export function updateAgentMessage(
  queue: QueuedAgentMessage[],
  id: string,
  text: string,
): QueuedAgentMessage[] {
  const trimmed = text.trim();
  if (!trimmed) return queue;
  return queue.map((message) =>
    message.id === id ? { ...message, text: trimmed } : message,
  );
}

/**
 * Pop the oldest message. Returns the message and remaining queue,
 * or null if the queue is empty.
 */
export function dequeueOldestAgentMessage(
  queue: QueuedAgentMessage[],
): { message: QueuedAgentMessage; remaining: QueuedAgentMessage[] } | null {
  if (queue.length === 0) return null;
  const [message, ...remaining] = queue;
  return { message, remaining };
}

/** Bytes to write to a PTY so the agent receives typed text + Enter. */
export function formatAgentMessageForPty(text: string): string {
  return `${text}\r`;
}

// Built via fromCharCode so the patterns avoid control chars in regex literals
// (eslint no-control-regex).
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const OSC_SEQUENCE = new RegExp(
  `${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`,
  "g",
);
const CSI_OR_ESC_SEQUENCE = new RegExp(
  `${ESC}(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~])`,
  "g",
);

function stripAnsiEscapes(output: string): string {
  return output.replace(OSC_SEQUENCE, "").replace(CSI_OR_ESC_SEQUENCE, "");
}

/** How many trailing non-empty lines to inspect for a user question. */
const QUESTION_TAIL_LINES = 15;

/**
 * True when recent agent output looks like a permission / confirmation prompt.
 * Those prompts go idle if unanswered; queued follow-ups must not auto-send
 * into them (that would answer Yes/No with the queued text).
 */
export function looksLikeAgentUserQuestion(output: string): boolean {
  const visible = stripAnsiEscapes(output).replace(/\r/g, "");
  const lines = visible
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return false;
  return lines.slice(-QUESTION_TAIL_LINES).some((line) => line.endsWith("?"));
}

/** True when the agent process has returned control to an interactive shell. */
export function looksLikeShellPrompt(output: string): boolean {
  const visible = stripAnsiEscapes(output).replace(/\r/g, "");
  const lastLine = visible
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .at(-1);
  if (!lastLine) return false;

  if (
    /^(?:(?:subsh|cmdsubst|mathsubst) )*(?:dquote|quote|cmdsubst|mathsubst|subsh)>\s*$/.test(
      lastLine,
    )
  ) {
    return true;
  }
  return /(?:^|\s)[$#%❯»]\s*$/.test(lastLine);
}
