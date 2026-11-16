import { beforeEach, describe, expect, it, vi } from 'vitest';
const scopedTransactionMock = vi.fn();
vi.mock('@/lib/db', () => ({ scopedTransaction: scopedTransactionMock }));
const { readInventoryCurrencySettings, updateInventoryCurrencySettings } =
  await import('./inventoryCurrencyRepository');
const scope = { tenantId: 'tenant-1', userId: 'user-1' };
const client = { query: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  scopedTransactionMock.mockImplementation(
    async (_scope: unknown, callback: (connection: typeof client) => Promise<unknown>) =>
      callback(client)
  );
});
describe('inventory currency repository', () => {
  it.each([
    ['owner', true],
    ['admin', true],
    ['member', false],
  ])('reads persisted role %s', async (role, canManageCurrency) => {
    client.query.mockResolvedValue({ rows: [{ currency_code: null, role }] });
    expect(await readInventoryCurrencySettings(scope)).toEqual({
      currency: null,
      canManageCurrency,
    });
    expect(scopedTransactionMock).toHaveBeenCalledWith(scope, expect.any(Function));
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('where t.id = $1 and m.user_id = $2'),
      [scope.tenantId, scope.userId]
    );
  });
  it('writes only currency and checks persisted membership in the same statement', async () => {
    client.query.mockResolvedValue({ rows: [{ currency_code: 'COP' }] });
    expect(await updateInventoryCurrencySettings(scope, 'COP')).toEqual({
      currency: 'COP',
      canManageCurrency: true,
    });
    expect(scopedTransactionMock).toHaveBeenCalledWith(scope, expect.any(Function));
    const [sql, params] = client.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('set currency_code = $3');
    expect(sql).toContain("m.role in ('owner', 'admin')");
    expect(sql).toContain('m.user_id = $2');
    expect(params).toEqual([scope.tenantId, scope.userId, 'COP']);
    expect(sql).not.toMatch(/recipe_inventory_items|updated_at|set role|set_config/i);
  });
  it('denies missing membership or denied write without inventing a setting', async () => {
    client.query.mockResolvedValue({ rows: [] });
    expect(await readInventoryCurrencySettings(scope)).toBeNull();
    expect(await updateInventoryCurrencySettings(scope, 'USD')).toBeNull();
  });
});
