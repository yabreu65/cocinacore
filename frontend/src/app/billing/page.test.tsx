import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ user: vi.fn(), scoped: vi.fn(), query: vi.fn() }));
vi.mock('@/lib/auth/server', () => ({ getCurrentUser: mocks.user }));
vi.mock('@/lib/db', () => ({ scopedTransaction: mocks.scoped }));
const { default: Page } = await import('./page');

describe('billing authenticated tenant scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: 'user-1', tenant: { tenantId: 'tenant-1', role: 'owner' } });
    mocks.query.mockResolvedValue({ rows: [] });
    mocks.scoped.mockImplementation(
      async (
        _scope: unknown,
        callback: (client: { query: typeof mocks.query }) => Promise<unknown>
      ) => callback({ query: mocks.query })
    );
  });

  it('runs the tenant-filtered reads through the authenticated scoped client', async () => {
    await Page();
    expect(mocks.scoped).toHaveBeenCalledOnce();
    expect(mocks.scoped).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', userId: 'user-1' },
      expect.any(Function)
    );
    expect(mocks.query).toHaveBeenCalledTimes(3);
    for (const call of mocks.query.mock.calls as unknown as [string, unknown[]][]) {
      expect(call[0]).toMatch(/(?:tenant_id|id) = \$1/);
      expect(call[1]).toEqual(['tenant-1']);
      expect(call[0]).not.toContain('password_hash');
    }
  });

  it('does not read data without an authenticated tenant', async () => {
    mocks.user.mockResolvedValueOnce(null);
    await Page();
    expect(mocks.scoped).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
