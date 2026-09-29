// Enter is a single "\r", as xterm sends it. The PTY turns that "\r" into a
// newline, so a trailing "\r\n" would reach the shell as two newlines and the
// second would be read by the launched agent as an extra Enter.
export const normalizeCommand = (command: string): string =>
  `${command.replace(/[\r\n]+$/, "")}\r`;
