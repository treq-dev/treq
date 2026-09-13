import { parseConnectionString } from '../parseConnectionString';

describe('parseConnectionString', () => {
  it('parses username@host:port#fingerprint', () => {
    expect(parseConnectionString('treq@127.0.0.1:2222#SHA256:abc123')).toEqual({
      username: 'treq',
      host: '127.0.0.1',
      port: 2222,
      fingerprintSha256: 'SHA256:abc123',
    });
  });

  it('trims surrounding whitespace', () => {
    expect(parseConnectionString('  treq@host:22#SHA256:x  ')).toEqual({
      username: 'treq',
      host: 'host',
      port: 22,
      fingerprintSha256: 'SHA256:x',
    });
  });

  it('throws on malformed input', () => {
    expect(() => parseConnectionString('not-a-connection-string')).toThrow(
      /username@host:port#fingerprint/,
    );
  });
});
