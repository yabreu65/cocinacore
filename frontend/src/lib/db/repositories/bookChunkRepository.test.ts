import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), scoped: vi.fn(), clientQuery: vi.fn() }));
vi.mock('@/lib/db', () => ({ query: mocks.query, scopedTransaction: mocks.scoped }));
const { searchChunks } = await import('./bookChunkRepository');

describe('scoped semantic search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clientQuery.mockResolvedValue({ rows: [] });
    mocks.scoped.mockImplementation(
      async (
        _scope: unknown,
        callback: (client: { query: typeof mocks.clientQuery }) => Promise<unknown>
      ) => callback({ query: mocks.clientQuery })
    );
  });
  it('uses one client for scope, both timeouts and vector query with safe source filters before limit', async () => {
    const options = {
      embedding: [0.1, 0.2],
      tenantId: 'tenant-1',
      userId: 'user-1',
      matchThreshold: 0.35,
      matchCount: 6,
      statementTimeoutMs: 1000,
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 2000,
    };
    await searchChunks(options);
    expect(mocks.scoped).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', userId: 'user-1' },
      expect.any(Function),
      { signal: options.signal, deadlineAt: options.deadlineAt }
    );
    expect(mocks.clientQuery.mock.calls.slice(0, 2)).toEqual([
      ["select set_config('statement_timeout', $1, true)", ['1000ms']],
      ["select set_config('lock_timeout', $1, true)", ['1000ms']],
    ]);
    const [sql, params] = mocks.clientQuery.mock.calls[2] as [string, unknown[]];
    expect(sql).toContain("bc.source_type = 'global_pdf'");
    expect(sql).toContain("bc.source_type = 'tenant_pdf'");
    expect(sql).toContain('tb.tenant_id = $4::uuid');
    expect(sql).not.toContain('ai_generated');
    expect(sql).toContain('order by bc.embedding <=> $1::vector(1536)');
    expect(sql).toContain('limit $3');
    expect(params).toEqual(['[0.1,0.2]', 0.35, 6, 'tenant-1']);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('rejects missing context and invalid timeouts before opening a connection', async () => {
    await expect(
      searchChunks({ embedding: [], tenantId: '', userId: 'user-1', statementTimeoutMs: 1000 })
    ).rejects.toThrow('scope required');
    await expect(
      searchChunks({ embedding: [], tenantId: 'tenant-1', userId: '', statementTimeoutMs: 1000 })
    ).rejects.toThrow('scope required');
    await expect(
      searchChunks({ embedding: [], tenantId: 'tenant-1', userId: 'user-1', statementTimeoutMs: 0 })
    ).rejects.toThrow('Statement timeout');
    expect(mocks.scoped).not.toHaveBeenCalled();
  });
});
