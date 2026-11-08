import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), scoped: vi.fn(), clientQuery: vi.fn() }));
vi.mock('@/lib/db', () => ({
  query: mocks.query,
  scopedTransaction: mocks.scoped,
  mapSingleRow: (result: { rows: unknown[] }) => result.rows[0] ?? null,
}));
const repo = await import('./pdfRepository');
describe('tenant PDF scoped operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clientQuery.mockResolvedValue({ rows: [{ id: 'pdf-1', count: '1' }] });
    mocks.scoped.mockImplementation(
      async (
        _scope: unknown,
        callback: (client: { query: typeof mocks.clientQuery }) => Promise<unknown>
      ) => callback({ query: mocks.clientQuery })
    );
  });
  it('uses tenant predicates on the scoped client for reads, counts and deletes', async () => {
    const scope = { tenantId: 'tenant-1', userId: 'user-1' };
    await repo.findTenantPdfById('tenant-1', 'pdf-1', scope);
    await repo.deleteTenantPdfById('tenant-1', 'pdf-1', scope);
    await repo.countTenantPdfsByBookId('tenant-1', 'book-1', scope);
    await repo.deleteTenantBookById('tenant-1', 'book-1', scope);
    await repo.findTenantBookById('tenant-1', 'book-1', scope);
    expect(mocks.scoped).toHaveBeenCalledTimes(5);
    for (const call of mocks.scoped.mock.calls) expect(call[0]).toEqual(scope);
    for (const [sql] of mocks.clientQuery.mock.calls as unknown as [string][])
      expect(sql).toContain('tenant_id = $');
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('rejects incompatible or absent scope before SQL', async () => {
    await expect(
      repo.findTenantPdfById('other', 'pdf-1', { tenantId: 'tenant-1', userId: 'user-1' })
    ).rejects.toThrow('scope mismatch');
    await expect(repo.findTenantPdfById('tenant-1', 'pdf-1', undefined!)).rejects.toThrow(
      'scope mismatch'
    );
    expect(mocks.scoped).not.toHaveBeenCalled();
  });
});
