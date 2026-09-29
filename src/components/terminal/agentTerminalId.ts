// Agent session columns in the terminal pane are keyed "agent-<sessionId>",
// alongside shell columns keyed "shell-...". The id names no agent: any
// supported agent runs in the same kind of column.
const AGENT_TERMINAL_PREFIX = "agent-";

export const agentTerminalId = (sessionId: number): string =>
  `${AGENT_TERMINAL_PREFIX}${sessionId}`;

/** The session id of an agent column id, or null for any other id. */
export const agentSessionIdOf = (terminalId: string): number | null =>
  terminalId.startsWith(AGENT_TERMINAL_PREFIX)
    ? Number(terminalId.slice(AGENT_TERMINAL_PREFIX.length))
    : null;
