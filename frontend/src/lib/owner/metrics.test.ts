import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  pool: vi.fn(),
  query: vi.fn(),
  error: vi.fn(),
  connect: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
}));
vi.mock('pg', () => ({ Pool: mocks.pool }));
vi.mock('@/lib/db', () => ({ query: mocks.query }));
vi.mock('@/lib/serverLogger', () => ({ serverLogger: { error: mocks.error } }));

describe('fixed owner metrics connection', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('DATABASE_URL', 'postgres://data');
    vi.stubEnv('AUTH_DATABASE_URL', 'postgres://auth');
    vi.stubEnv('OWNER_METRICS_DATABASE_URL', 'postgres://metrics');
    vi.stubEnv('COCINACORE_OWNER_METRICS_DB_ENABLED', 'true');
    mocks.connect.mockResolvedValue({ query: mocks.clientQuery, release: mocks.release });
    mocks.pool.mockImplementation(function () {
      return { connect: mocks.connect, on: vi.fn() };
    });
    mocks.clientQuery.mockResolvedValue({
      rows: [
        { tenants: '1', users: '2', books: '3', pdfs: '4', chunks: '5', reports: '6', owners: '7' },
      ],
    });
  });
  afterEach(() => vi.unstubAllEnvs());
  it('queries only the fixed view on the dedicated connection', async () => {
    const { getOwnerMetrics } = await import('./metrics');
    expect(await getOwnerMetrics()).toEqual({
      tenants: 1,
      users: 2,
      books: 3,
      pdfs: 4,
      chunks: 5,
      reports: 6,
      owners: 7,
    });
    expect(mocks.clientQuery).toHaveBeenCalledWith(
      'select tenants, users, books, pdfs, chunks, reports, owners from public.owner_global_metrics'
    );
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('fails closed without a valid separate URL', async () => {
    vi.stubEnv('OWNER_METRICS_DATABASE_URL', '');
    const { getOwnerMetrics } = await import('./metrics');
    await expect(getOwnerMetrics()).rejects.toThrow('Owner metrics are unavailable');
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.pool).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith('owner.metrics.query_failed', { stage: 'configuration', reason: 'metrics_configuration_invalid' });
  });
  it('rejects partial results and releases the connection', async () => {
    mocks.clientQuery.mockResolvedValue({
      rows: [
        {
          tenants: null,
          users: null,
          books: null,
          pdfs: null,
          chunks: null,
          reports: null,
          owners: null,
        },
      ],
    });
    const { getOwnerMetrics } = await import('./metrics');
    await expect(getOwnerMetrics()).rejects.toThrow('Owner metrics are unavailable');
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it.each([
    ['connection', '28P01', 'db_authentication_failed'],
    ['query', '42501', 'db_permission_denied'],
    ['query', '42P01', 'db_schema_unavailable'],
    ['connection', 'ECONNREFUSED', 'network_failure'],
  ])('classifies %s failure without exposing details or retrying through another connection', async (stage, code, reason) => {
    const failure = Object.assign(new Error('internal connection detail'), { code });
    if (stage === 'connection') mocks.connect.mockRejectedValueOnce(failure);
    else mocks.clientQuery.mockRejectedValueOnce(failure);
    const { getOwnerMetrics } = await import('./metrics');
    await expect(getOwnerMetrics()).rejects.toThrow('Owner metrics are unavailable');
    expect(mocks.error).toHaveBeenCalledWith('owner.metrics.query_failed', { stage, reason });
    expect(JSON.stringify(mocks.error.mock.calls)).not.toContain('internal connection detail');
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledTimes(stage === 'query' ? 1 : 0);
  });

  it.each([
    [[], 'metrics_missing_result'],
    [[{ tenants: null, users: null, books: null, pdfs: null, chunks: null, reports: null, owners: null }], 'metrics_unavailable_result'],
    [[{ tenants: 'invalid', users: '2', books: '3', pdfs: '4', chunks: '5', reports: '6', owners: '7' }], 'metrics_invalid_result'],
  ])('classifies unavailable or malformed result while rejecting the entire read', async (rows, reason) => {
    mocks.clientQuery.mockResolvedValueOnce({ rows });
    const { getOwnerMetrics } = await import('./metrics');
    await expect(getOwnerMetrics()).rejects.toThrow('Owner metrics are unavailable');
    expect(mocks.error).toHaveBeenCalledWith('owner.metrics.query_failed', { stage: 'result', reason });
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('preserves the legacy seven data reads when disabled', async () => {
    vi.stubEnv('COCINACORE_OWNER_METRICS_DB_ENABLED', 'false');
    mocks.query
      .mockResolvedValueOnce({ rows: [{ can_use_legacy_counts: true }] })
      .mockResolvedValue({ rows: [{ count: '4' }] });
    const { getOwnerMetrics } = await import('./metrics');
    expect(await getOwnerMetrics()).toEqual({
      tenants: 4,
      users: 4,
      books: 4,
      pdfs: 4,
      chunks: 4,
      reports: 4,
      owners: 4,
    });
    expect(mocks.query).toHaveBeenCalledTimes(8);
    expect(mocks.pool).not.toHaveBeenCalled();
  });

  it('fails closed before legacy counts when a source has RLS enabled', async () => {
    vi.stubEnv('COCINACORE_OWNER_METRICS_DB_ENABLED', 'false');
    mocks.query.mockResolvedValueOnce({ rows: [{ can_use_legacy_counts: false }] });
    const { getOwnerMetrics } = await import('./metrics');
    await expect(getOwnerMetrics()).rejects.toThrow('Owner metrics are unavailable');
    expect(mocks.query).toHaveBeenCalledOnce();
    expect(mocks.pool).not.toHaveBeenCalled();
  });
});
