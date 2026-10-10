import { beforeEach, describe, expect, it, vi } from 'vitest';

const { PoolMock, connectMock, clientQueryMock, releaseMock } = vi.hoisted(() => ({
  PoolMock: vi.fn(),
  connectMock: vi.fn(),
  clientQueryMock: vi.fn(),
  releaseMock: vi.fn(),
}));

vi.mock('pg', () => ({
  Pool: PoolMock,
  types: {
    builtins: { TIMESTAMPTZ: 1184, TIMESTAMP: 1114 },
    setTypeParser: vi.fn(),
  },
}));

import { transaction } from './db';

describe('transaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://test:test@localhost/test';
    PoolMock.mockImplementation(function () {
      return {
        connect: connectMock,
        on: vi.fn(),
      };
    });
    connectMock.mockResolvedValue({
      query: clientQueryMock,
      release: releaseMock,
    });
    clientQueryMock.mockResolvedValue({ rows: [] });
  });

  it('releases the client when BEGIN rejects without calling the callback or committing', async () => {
    const beginError = new Error('begin failed');
    const callback = vi.fn();
    clientQueryMock.mockRejectedValueOnce(beginError);

    await expect(transaction(callback)).rejects.toBe(beginError);

    expect(callback).not.toHaveBeenCalled();
    expect(clientQueryMock).toHaveBeenCalledTimes(1);
    expect(clientQueryMock.mock.calls).toEqual([['begin']]);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('commits a successful callback and releases the client once', async () => {
    const callback = vi.fn().mockResolvedValue('result');

    await expect(transaction(callback)).resolves.toBe('result');

    expect(callback).toHaveBeenCalledTimes(1);
    expect(clientQueryMock.mock.calls).toEqual([['begin'], ['commit']]);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('rolls back and releases the client when the callback fails', async () => {
    const callbackError = new Error('callback failed');
    const callback = vi.fn().mockRejectedValue(callbackError);

    await expect(transaction(callback)).rejects.toBe(callbackError);

    expect(clientQueryMock.mock.calls).toEqual([['begin'], ['rollback']]);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('rolls back and rethrows the original error when COMMIT fails', async () => {
    const commitError = new Error('commit failed');
    const callback = vi.fn().mockResolvedValue('result');
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(commitError);

    await expect(transaction(callback)).rejects.toBe(commitError);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(clientQueryMock.mock.calls).toEqual([['begin'], ['commit'], ['rollback']]);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('preserves the callback error and releases when ROLLBACK fails', async () => {
    const callbackError = new Error('callback failed');
    const rollbackError = new Error('rollback failed');
    const callback = vi.fn().mockRejectedValue(callbackError);
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(rollbackError);

    await expect(transaction(callback)).rejects.toBe(callbackError);

    expect(clientQueryMock.mock.calls).toEqual([['begin'], ['rollback']]);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });
});
