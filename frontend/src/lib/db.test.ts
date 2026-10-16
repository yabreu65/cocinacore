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

import { queryWithStatementTimeout, transaction } from './db';

describe('queryWithStatementTimeout', () => {
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
    clientQueryMock.mockResolvedValue({ rows: [{ value: 1 }] });
  });

  it('sets a transaction-local timeout, runs the query, commits, and releases once', async () => {
    await queryWithStatementTimeout('select $1 as value', ['result'], 10_000);

    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(clientQueryMock.mock.calls).toEqual([
      ['begin'],
      ["select set_config('statement_timeout', $1, true)", ['10000ms']],
      ['select $1 as value', ['result']],
      ['commit'],
    ]);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('rolls back on PostgreSQL statement timeout and preserves the query error', async () => {
    const timeoutError = Object.assign(new Error('statement timeout'), { code: '57014' });
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(timeoutError);

    await expect(queryWithStatementTimeout('select pg_sleep(2)', [], 100)).rejects.toBe(timeoutError);

    expect(clientQueryMock.mock.calls).toEqual([
      ['begin'],
      ["select set_config('statement_timeout', $1, true)", ['100ms']],
      ['select pg_sleep(2)', []],
      ['rollback'],
    ]);
    expect(clientQueryMock.mock.calls.some(([sql]) => sql === 'commit')).toBe(false);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });
});

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
    expect(releaseMock).toHaveBeenCalledWith();
  });

  it('commits a successful callback and releases the client once', async () => {
    const callback = vi.fn().mockResolvedValue('result');

    await expect(transaction(callback)).resolves.toBe('result');

    expect(callback).toHaveBeenCalledTimes(1);
    expect(clientQueryMock.mock.calls).toEqual([['begin'], ['commit']]);
    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledWith();
  });

  it('rolls back and releases the client when the callback fails', async () => {
    const callbackError = new Error('callback failed');
    const callback = vi.fn().mockRejectedValue(callbackError);

    await expect(transaction(callback)).rejects.toBe(callbackError);

    expect(clientQueryMock.mock.calls).toEqual([['begin'], ['rollback']]);
    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledWith();
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
    expect(releaseMock).toHaveBeenCalledWith();
  });

  it('discards the client when rollback fails after COMMIT fails', async () => {
    const commitError = new Error('commit failed');
    const rollbackError = new Error('rollback failed');
    const callback = vi.fn().mockResolvedValue('result');
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(commitError)
      .mockRejectedValueOnce(rollbackError);

    await expect(transaction(callback)).rejects.toBe(commitError);

    expect(clientQueryMock.mock.calls).toEqual([['begin'], ['commit'], ['rollback']]);
    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledWith(rollbackError);
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
    expect(releaseMock).toHaveBeenCalledWith(rollbackError);
  });
});
