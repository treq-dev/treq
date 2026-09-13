import TreqSsh from '../../native/TreqSsh';
import { runMutationWithRetry } from '../mutationRetry';

describe('runMutationWithRetry', () => {
  beforeEach(() => jest.clearAllMocks());

  const noBackoff = { backoffMs: () => 0 };

  it('returns the result on first success without retrying', async () => {
    (TreqSsh.execCommand as jest.Mock).mockResolvedValue({ exitStatus: 0, stdout: 'ok', stderr: '' });

    const argv = ['commits', 'create', '--idempotency-key', 'key-1'];
    const result = await runMutationWithRetry('session-1', argv, noBackoff);

    expect(result).toEqual({ exitStatus: 0, stdout: 'ok', stderr: '' });
    expect(TreqSsh.execCommand).toHaveBeenCalledTimes(1);
  });

  it('retries the exact same argv (same idempotency key) after a transport failure', async () => {
    (TreqSsh.execCommand as jest.Mock)
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce({ exitStatus: 0, stdout: 'applied once', stderr: '' });

    const argv = ['commits', 'create', '--idempotency-key', 'key-1'];
    const result = await runMutationWithRetry('session-1', argv, noBackoff);

    expect(result.stdout).toBe('applied once');
    expect(TreqSsh.execCommand).toHaveBeenCalledTimes(2);
    expect(TreqSsh.execCommand).toHaveBeenNthCalledWith(1, 'session-1', argv);
    expect(TreqSsh.execCommand).toHaveBeenNthCalledWith(2, 'session-1', argv);
    // Every retry carries the identical idempotency key, so a mutation that
    // actually landed on the VM before the drop is not double-applied.
    const [firstCallArgv] = (TreqSsh.execCommand as jest.Mock).mock.calls[0].slice(1);
    const [secondCallArgv] = (TreqSsh.execCommand as jest.Mock).mock.calls[1].slice(1);
    expect(firstCallArgv).toEqual(secondCallArgv);
  });

  it('does not retry a structured CLI error (non-zero exit status)', async () => {
    (TreqSsh.execCommand as jest.Mock).mockResolvedValue({ exitStatus: 1, stdout: '', stderr: 'invalid_arguments' });

    const result = await runMutationWithRetry('session-1', ['commits', 'create'], noBackoff);

    expect(result.exitStatus).toBe(1);
    expect(TreqSsh.execCommand).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxAttempts and surfaces the last error', async () => {
    (TreqSsh.execCommand as jest.Mock).mockRejectedValue(new Error('still down'));

    await expect(
      runMutationWithRetry('session-1', ['commits', 'create'], { ...noBackoff, maxAttempts: 3 }),
    ).rejects.toThrow('still down');
    expect(TreqSsh.execCommand).toHaveBeenCalledTimes(3);
  });
});
