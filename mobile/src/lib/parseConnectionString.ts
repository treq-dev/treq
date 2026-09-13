export type ParsedConnection = {
  username: string;
  host: string;
  port: number;
  fingerprintSha256: string;
};

/**
 * Temporary shortcut for manual testing: parses a single raw
 * `username@host:port#fingerprint` string into the four fields
 * ConnectScreen otherwise collects individually. Not a real connection
 * profile format - there is no persistence, alias, or validation beyond
 * shape, and it goes away once registered/saved endpoints (prds/mobile.md
 * Phase 3+) replace it.
 */
export function parseConnectionString(input: string): ParsedConnection {
  const match = /^([^@]+)@([^:]+):(\d+)#(.+)$/.exec(input.trim());
  if (!match) {
    throw new Error(
      'Expected format username@host:port#fingerprint, e.g. treq@127.0.0.1:2222#SHA256:abc123',
    );
  }
  const [, username, host, portText, fingerprintSha256] = match;
  return { username, host, port: Number(portText), fingerprintSha256 };
}
