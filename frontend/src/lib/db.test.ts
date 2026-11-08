import { beforeEach, describe, expect, it, vi } from 'vitest';

const { PoolMock, connectMock, clientQueryMock, releaseMock } = vi.hoisted(() => ({
  PoolMock: vi.fn(),
  connectMock: vi.fn(),
  clientQueryMock: vi.fn(),
  releaseMock: vi.fn(),
}));
const loggerErrorMock = vi.hoisted(() => vi.fn());

vi.mock('pg', () => ({
  Pool: PoolMock,
  types: {
    builtins: { TIMESTAMPTZ: 1184, TIMESTAMP: 1114 },
    setTypeParser: vi.fn(),
  },
}));
vi.mock('./serverLogger', () => ({
  serverLogger: { error: loggerErrorMock, warn: vi.fn(), info: vi.fn() },
}));

import { query, queryWithStatementTimeout, scopedTransaction, transaction } from './db';

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

  it('scopes the callback on the transaction connection and commits', async () => {
    const scope = {
      tenantId: '00000000-0000-4000-8000-000000000001',
      userId: '00000000-0000-4000-8000-000000000002',
    };
    await scopedTransaction(scope, (client) => client.query('select 42'));
    expect(clientQueryMock.mock.calls).toEqual([
      ['begin'],
      [
        "select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)",
        [scope.tenantId, scope.userId],
      ],
      ['select 42'],
      ['commit'],
    ]);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('rolls back scoped errors and rejects malformed scope before acquisition', async () => {
    const scope = {
      tenantId: '00000000-0000-4000-8000-000000000001',
      userId: '00000000-0000-4000-8000-000000000002',
    };
    await expect(
      scopedTransaction(scope, () => {
        throw new Error('failure');
      })
    ).rejects.toThrow('failure');
    expect(clientQueryMock.mock.calls.at(-1)).toEqual(['rollback']);
    expect(releaseMock).toHaveBeenCalledTimes(1);
    connectMock.mockClear();
    await expect(scopedTransaction({ ...scope, userId: 'bad' }, () => undefined)).rejects.toThrow(
      'Invalid database scope'
    );
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('does not log database error text, SQL, or parameters', async () => {
    const secretError = Object.assign(
      new Error('password=top-secret token=abc sql=select secret from users'),
      { code: '23505' }
    );
    clientQueryMock.mockRejectedValueOnce(secretError);

    await expect(query('select $1 as value', ['top-secret'])).rejects.toBe(secretError);

    expect(loggerErrorMock).toHaveBeenCalledWith('db.query.error', {
      reason: 'db_unique_violation',
      operation: 'query',
    });
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('top-secret');
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('select secret');
  });

  it('sets a transaction-local timeout, runs the query, commits, and releases once', async () => {
    await queryWithStatementTimeout('select $1 as value', ['result'], 10_000);

    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(clientQueryMock.mock.calls).toEqual([
      ['begin'],
      ["select set_config('statement_timeout', $1, true)", ['10000ms']],
      ["select set_config('lock_timeout', $1, true)", ['10000ms']],
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
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(timeoutError);

    await expect(queryWithStatementTimeout('select pg_sleep(2)', [], 100)).rejects.toBe(
      timeoutError
    );

    expect(clientQueryMock.mock.calls).toEqual([
      ['begin'],
      ["select set_config('statement_timeout', $1, true)", ['100ms']],
      ["select set_config('lock_timeout', $1, true)", ['100ms']],
      ['select pg_sleep(2)', []],
      ['rollback'],
    ]);
    expect(clientQueryMock.mock.calls.some(([sql]) => sql === 'commit')).toBe(false);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('discards an active client when the shared signal aborts', async () => {
    const controller = new AbortController();
    let rejectQuery: ((error: Error) => void) | undefined;
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectQuery = reject;
          })
      );
    releaseMock.mockImplementation((error?: Error) => {
      if (error) rejectQuery?.(error);
    });

    const pending = queryWithStatementTimeout('select pg_sleep(10)', [], 10_000, {
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(Error);
    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(releaseMock.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(clientQueryMock.mock.calls.some(([sql]) => sql === 'rollback')).toBe(false);
  });

  it('discards a client that arrives after pool acquisition was cancelled', async () => {
    const controller = new AbortController();
    let resolveConnection:
      | ((client: { query: typeof clientQueryMock; release: typeof releaseMock }) => void)
      | undefined;
    connectMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveConnection = resolve;
        })
    );

    const pending = query('select 1', [], { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(Error);

    const lateClient = { query: clientQueryMock, release: releaseMock };
    resolveConnection?.(lateClient);
    await Promise.resolve();
    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(releaseMock.mock.calls[0]?.[0]).toBeInstanceOf(Error);
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
    clientQueryMock.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(commitError);

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
    clientQueryMock.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(rollbackError);

    await expect(transaction(callback)).rejects.toBe(callbackError);

    expect(clientQueryMock.mock.calls).toEqual([['begin'], ['rollback']]);
    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledWith(rollbackError);
  });
});

describe('scopedTransaction cancellation and validation', () => {
  const scope = {
    tenantId: '12345678-1234-1234-1234-123456789abc',
    userId: 'abcdefab-cdef-abcd-efab-cdefabcdefab',
  };
  const contextSql =
    "select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)";

  beforeEach(() => {
    vi.clearAllMocks();
    releaseMock.mockReset();
    connectMock.mockResolvedValue({ query: clientQueryMock, release: releaseMock });
    clientQueryMock.mockResolvedValue({ rows: [] });
  });

  it('rejects malformed tenant and user UUIDs before acquisition', async () => {
    for (const invalid of [
      { ...scope, tenantId: 'invalid' },
      { ...scope, userId: `${scope.userId}\n` },
      { ...scope, userId: "x'); reset all; --" },
    ]) {
      await expect(scopedTransaction(invalid, vi.fn())).rejects.toThrow('Invalid database scope.');
    }
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('rolls back and does not call the callback if context setup fails', async () => {
    const failure = new Error('failure');
    clientQueryMock.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(failure);
    const callback = vi.fn();
    await expect(scopedTransaction(scope, callback)).rejects.toBe(failure);
    expect(callback).not.toHaveBeenCalled();
    expect(clientQueryMock.mock.calls).toEqual([
      ['begin'],
      [contextSql, [scope.tenantId, scope.userId]],
      ['rollback'],
    ]);
    expect(releaseMock).toHaveBeenCalledWith();
  });

  it('discards the client and does not commit when cancelled during the callback', async () => {
    const controller = new AbortController();
    let finish!: () => void;
    const started = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let resume!: () => void;
    const wait = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const pending = scopedTransaction(
      scope,
      async () => {
        finish();
        await wait;
        return 'result';
      },
      { signal: controller.signal }
    );
    await started;
    controller.abort();
    resume();
    await expect(pending).rejects.toThrow('Database operation cancelled.');
    expect(clientQueryMock.mock.calls).toEqual([
      ['begin'],
      [contextSql, [scope.tenantId, scope.userId]],
    ]);
    expect(releaseMock).toHaveBeenCalledOnce();
    expect(releaseMock.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });
});
