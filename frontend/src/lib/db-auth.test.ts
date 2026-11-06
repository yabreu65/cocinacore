import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  Pool: vi.fn(),
  error: vi.fn(),
}));

vi.mock('pg', () => ({
  Pool: mocks.Pool,
  types: { builtins: { TIMESTAMPTZ: 1184, TIMESTAMP: 1114 }, setTypeParser: vi.fn() },
}));
vi.mock('./serverLogger', () => ({ serverLogger: { error: mocks.error } }));

const dataUrl = 'postgres://data:data-secret@localhost/data';
const authUrl = 'postgres://auth:auth-secret@localhost/auth';

describe('authentication database boundary', () => {
  const dataQuery = vi.fn();
  const authClientQuery = vi.fn();
  const dataRelease = vi.fn();
  const authRelease = vi.fn();
  const dataConnect = vi.fn();
  const authConnect = vi.fn();
  const on = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('DATABASE_URL', dataUrl);
    vi.stubEnv('AUTH_DATABASE_URL', authUrl);
    vi.stubEnv('COCINACORE_SEPARATE_AUTH_DB', 'true');
    dataQuery.mockReset().mockResolvedValue({ rows: [] });
    authClientQuery.mockReset().mockResolvedValue({ rows: [] });
    dataRelease.mockReset();
    authRelease.mockReset();
    dataConnect.mockReset().mockResolvedValue({ query: dataQuery, release: dataRelease });
    authConnect.mockReset().mockResolvedValue({ query: authClientQuery, release: authRelease });
    mocks.Pool.mockImplementation(function (options: { connectionString: string }) {
      return { connect: options.connectionString === authUrl ? authConnect : dataConnect, on };
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('uses a distinct configured auth pool and keeps the data pool separate', async () => {
    const { authQuery, query } = await import('./db');
    await authQuery('select $1', ['token']);
    await query('select 1');
    expect(authConnect).toHaveBeenCalledOnce();
    expect(dataConnect).toHaveBeenCalledOnce();
    expect(authClientQuery).toHaveBeenCalledWith('select $1', ['token']);
    expect(dataQuery).toHaveBeenCalledWith('select 1', undefined);
    expect(authRelease).toHaveBeenCalledOnce();
    expect(dataRelease).toHaveBeenCalledOnce();
  });

  it('fails closed on missing, identical, or invalid separate configuration', async () => {
    const { authQuery, authTransaction } = await import('./db');
    vi.stubEnv('AUTH_DATABASE_URL', '');
    await expect(authQuery('select 1')).rejects.toThrow('AUTH_DATABASE_URL is required');
    vi.stubEnv('AUTH_DATABASE_URL', dataUrl);
    await expect(authTransaction(() => undefined)).rejects.toThrow('configured separately');
    vi.stubEnv('COCINACORE_SEPARATE_AUTH_DB', 'yes');
    await expect(authQuery('select 1')).rejects.toThrow(
      'Invalid authentication database configuration'
    );
    expect(dataConnect).not.toHaveBeenCalled();
    expect(authConnect).not.toHaveBeenCalled();
    expect(mocks.Pool).not.toHaveBeenCalled();
  });

  it('uses the existing pool when separation is off', async () => {
    vi.stubEnv('COCINACORE_SEPARATE_AUTH_DB', undefined);
    const { authQuery, authTransaction, query } = await import('./db');
    await authQuery('select 1');
    await authTransaction((client) => client.query('select 2'));
    await query('select 3');
    expect(mocks.Pool).toHaveBeenCalledOnce();
    expect(dataConnect).toHaveBeenCalledTimes(3);
    expect(authConnect).not.toHaveBeenCalled();
    expect((dataQuery.mock.calls as unknown as [string][]).map(([sql]) => sql)).toEqual([
      'select 1',
      'begin',
      'select 2',
      'commit',
      'select 3',
    ]);
  });

  it('uses the data pool when separation is explicitly false', async () => {
    vi.stubEnv('COCINACORE_SEPARATE_AUTH_DB', 'false');
    const { authQuery } = await import('./db');
    await authQuery('select 1');
    expect(dataConnect).toHaveBeenCalledOnce();
    expect(authConnect).not.toHaveBeenCalled();
  });

  it('commits multiple operations on one auth client and rolls back failures', async () => {
    const { authTransaction } = await import('./db');
    await expect(
      authTransaction(async (client) => {
        await client.query('first');
        await client.query('second');
        return 'ok';
      })
    ).resolves.toBe('ok');
    expect(authConnect).toHaveBeenCalledOnce();
    expect((authClientQuery.mock.calls as unknown as [string][]).map(([sql]) => sql)).toEqual([
      'begin',
      'first',
      'second',
      'commit',
    ]);
    expect(authRelease).toHaveBeenCalledOnce();

    const failure = new Error('failure');
    authClientQuery.mockClear();
    await expect(
      authTransaction(async (client) => {
        await client.query('first');
        throw failure;
      })
    ).rejects.toBe(failure);
    expect((authClientQuery.mock.calls as unknown as [string][]).map(([sql]) => sql)).toEqual([
      'begin',
      'first',
      'rollback',
    ]);
    expect(authRelease).toHaveBeenCalledTimes(2);
  });

  it.each(['tenant', 'user', 'membership', 'session', 'commit'] as const)(
    'rolls back a signup-like transaction when %s fails',
    async (stage) => {
      const { authTransaction } = await import('./db');
      const failure = new Error(`${stage} failure`);
      authClientQuery.mockImplementation(async (sql: string) => {
        if (sql === stage) throw failure;
        return { rows: [] };
      });
      await expect(
        authTransaction(async (client) => {
          await client.query('tenant');
          await client.query('user');
          await client.query('membership');
          await client.query('session');
        })
      ).rejects.toBe(failure);
      expect(authConnect).toHaveBeenCalledOnce();
      expect((authClientQuery.mock.calls as unknown as [string][]).at(-1)).toEqual(['rollback']);
      expect(authRelease).toHaveBeenCalledOnce();
      expect(dataConnect).not.toHaveBeenCalled();
    }
  );

  it('discards a client if rollback fails and preserves the original error', async () => {
    const { authTransaction } = await import('./db');
    const failure = new Error('callback');
    const rollbackFailure = new Error('rollback');
    authClientQuery.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(rollbackFailure);
    await expect(
      authTransaction(() => {
        throw failure;
      })
    ).rejects.toBe(failure);
    expect(authRelease).toHaveBeenCalledOnce();
    expect(authRelease).toHaveBeenCalledWith(rollbackFailure);
  });

  it('cancels acquisition and releases a late auth client', async () => {
    const { authQuery } = await import('./db');
    const controller = new AbortController();
    let resolveConnection!: (client: {
      query: typeof authClientQuery;
      release: typeof authRelease;
    }) => void;
    authConnect.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveConnection = resolve;
        })
    );
    const pending = authQuery('select 1', [], { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow('Database operation cancelled.');
    resolveConnection({ query: authClientQuery, release: authRelease });
    await Promise.resolve();
    expect(authRelease).toHaveBeenCalledOnce();
    expect(authRelease.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });

  it('discards an active auth query on abort', async () => {
    const { authQuery } = await import('./db');
    const controller = new AbortController();
    let rejectQuery!: (error: Error) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    authClientQuery.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectQuery = reject;
          started();
        })
    );
    authRelease.mockImplementation((error?: Error) => {
      if (error) rejectQuery(error);
    });
    const pending = authQuery('select 1', [], { signal: controller.signal });
    await ready;
    controller.abort();
    await expect(pending).rejects.toThrow('Database operation cancelled.');
    expect(authRelease).toHaveBeenCalledOnce();
    expect(authRelease.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });

  it('rejects changing the configured auth URL after pool creation', async () => {
    const { authQuery } = await import('./db');
    await authQuery('select 1');
    vi.stubEnv('AUTH_DATABASE_URL', 'postgres://other:changed-secret@localhost/auth');
    await expect(authQuery('select 2')).rejects.toThrow('restart the process');
    expect(authConnect).toHaveBeenCalledOnce();
    expect(dataConnect).not.toHaveBeenCalled();
  });

  it('discards a transaction client at deadline and never commits', async () => {
    vi.useFakeTimers();
    const { authTransaction } = await import('./db');
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    let resume!: () => void;
    const wait = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const pending = authTransaction(
      async () => {
        started();
        await wait;
      },
      { deadlineAt: Date.now() + 100 }
    );
    await ready;
    await vi.advanceTimersByTimeAsync(100);
    resume();
    await expect(pending).rejects.toThrow('Database operation cancelled.');
    expect((authClientQuery.mock.calls as unknown as [string][]).map(([sql]) => sql)).toEqual([
      'begin',
    ]);
    expect(authRelease).toHaveBeenCalledOnce();
    expect(authRelease.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });

  it('sanitizes background auth pool errors', async () => {
    const { authQuery } = await import('./db');
    await authQuery('select 1');
    const handler = (on.mock.calls as unknown as [string, (error: Error) => void][])[0][1];
    handler(new Error('postgres://auth:auth-secret@localhost/auth token-sensitive'));
    expect(mocks.error).toHaveBeenCalledWith('db.pool.error', {
      reason: expect.any(String) as unknown as string,
      operation: 'auth_pool',
    });
    expect(JSON.stringify(mocks.error.mock.calls)).not.toMatch(/auth-secret|token-sensitive/);
  });

  it('does not log connection secrets, SQL, parameters, or database error text', async () => {
    const { authQuery } = await import('./db');
    const failure = Object.assign(new Error('auth-secret token-sensitive'), { code: '23505' });
    authClientQuery.mockRejectedValueOnce(failure);
    await expect(authQuery('select secret', ['token-sensitive'])).rejects.toBe(failure);
    expect(mocks.error).toHaveBeenCalledWith('db.query.error', {
      reason: 'db_unique_violation',
      operation: 'auth_query',
    });
    expect(JSON.stringify(mocks.error.mock.calls)).not.toMatch(
      /auth-secret|token-sensitive|select secret/
    );
  });
});
