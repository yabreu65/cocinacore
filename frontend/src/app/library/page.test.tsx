import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  scopedTransaction: vi.fn(),
  clientQuery: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('@/lib/db', () => ({ scopedTransaction: mocks.scopedTransaction }));

const { default: LibraryPage } = await import('./page');

describe('authenticated library page data access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({
      id: 'authenticated-user',
      tenant: { tenantId: 'authenticated-tenant', tenantType: 'home' },
    });
    mocks.clientQuery.mockResolvedValue({ rows: [] });
    mocks.scopedTransaction.mockImplementation(
      async (
        _scope: unknown,
        operation: (client: { query: typeof mocks.clientQuery }) => Promise<unknown>
      ) => operation({ query: mocks.clientQuery })
    );
  });

  it('loads books and PDFs on the same scoped client and authenticated tenant/user', async () => {
    await LibraryPage();
    expect(mocks.scopedTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.scopedTransaction.mock.calls[0]?.[0]).toEqual({
      tenantId: 'authenticated-tenant',
      userId: 'authenticated-user',
    });
    expect(mocks.clientQuery).toHaveBeenCalledTimes(2);
    for (const [sql, params] of mocks.clientQuery.mock.calls as [string, unknown[]][]) {
      expect(sql).toContain('tenant_id = $1');
      expect(params).toEqual(['authenticated-tenant']);
    }
  });

  it('does not query tenant documents without an authenticated tenant', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'authenticated-user', tenant: null });
    await LibraryPage();
    expect(mocks.scopedTransaction).not.toHaveBeenCalled();
    expect(mocks.clientQuery).not.toHaveBeenCalled();
  });
});
