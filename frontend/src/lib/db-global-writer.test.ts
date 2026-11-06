import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ pool: vi.fn(), error: vi.fn() }));
vi.mock('pg', () => ({
  Pool: mocks.pool,
  types: { builtins: { TIMESTAMPTZ: 1184, TIMESTAMP: 1114 }, setTypeParser: vi.fn() },
}));
vi.mock('./serverLogger', () => ({ serverLogger: { error: mocks.error } }));
const query = vi.fn();
const release = vi.fn();
const connect = vi.fn();
describe('global writer pool selection', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('DATABASE_URL', 'postgres://data');
    vi.stubEnv('AUTH_DATABASE_URL', 'postgres://auth');
    vi.stubEnv('OWNER_METRICS_DATABASE_URL', 'postgres://metrics');
    vi.stubEnv('OWNER_GLOBAL_WRITER_DATABASE_URL', 'postgres://writer');
    vi.stubEnv('COCINACORE_OWNER_GLOBAL_WRITER_ENABLED', 'true');
    query.mockResolvedValue({ rows: [] });
    connect.mockResolvedValue({ query, release });
    mocks.pool.mockImplementation(function () {
      return { connect, on: vi.fn() };
    });
  });
  afterEach(() => vi.unstubAllEnvs());
  it('uses only the explicit writer pool and same transaction client', async () => {
    const { globalWriterTransaction } = await import('./db');
    await globalWriterTransaction(async (client) => {
      await client.query('first');
      await client.query('second');
    });
    expect(mocks.pool).toHaveBeenCalledWith(
      expect.objectContaining({ connectionString: 'postgres://writer' })
    );
    expect((query.mock.calls as [string][]).map(([sql]) => sql)).toEqual([
      'begin',
      'first',
      'second',
      'commit',
    ]);
    expect(release).toHaveBeenCalledOnce();
  });
  it('rejects absent, shared, or invalid configuration without fallback', async () => {
    const { globalWriterTransaction } = await import('./db');
    for (const value of ['', 'postgres://data', 'postgres://auth', 'postgres://metrics']) {
      vi.stubEnv('OWNER_GLOBAL_WRITER_DATABASE_URL', value);
      await expect(globalWriterTransaction(() => undefined)).rejects.toThrow();
    }
    vi.stubEnv('COCINACORE_OWNER_GLOBAL_WRITER_ENABLED', 'invalid');
    await expect(globalWriterTransaction(() => undefined)).rejects.toThrow();
    expect(mocks.pool).not.toHaveBeenCalled();
  });
  it('keeps the data pool when disabled', async () => {
    vi.stubEnv('COCINACORE_OWNER_GLOBAL_WRITER_ENABLED', 'false');
    const { globalWriterTransaction } = await import('./db');
    await globalWriterTransaction(() => undefined);
    expect(mocks.pool).toHaveBeenCalledWith(
      expect.objectContaining({ connectionString: 'postgres://data' })
    );
  });
});
