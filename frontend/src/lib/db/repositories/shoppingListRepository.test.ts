import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const mapSingleRowMock = vi.fn();

vi.mock('@/lib/db', () => ({
  query: queryMock,
  mapSingleRow: mapSingleRowMock,
}));

const {
  createShoppingListItem,
  deleteShoppingListItem,
  listShoppingListItems,
  updateShoppingListItemStatus,
} = await import('./shoppingListRepository');

const row = {
  id: 'shopping-1',
  tenant_id: 'tenant-1',
  user_id: 'user-1',
  source: 'manual',
  premium_recipe_id: null,
  ingredient_name: 'Arroz',
  quantity: '1 kg',
  status: 'pending' as const,
  created_at: '2026-03-16T00:00:00.000Z',
  updated_at: '2026-03-16T00:00:00.000Z',
};

describe('shoppingListRepository', () => {
  beforeEach(() => {
    queryMock.mockReset();
    mapSingleRowMock.mockReset();
    mapSingleRowMock.mockImplementation((result: { rows: unknown[] }) => result.rows[0] ?? null);
  });

  it('lists only authenticated tenant and user rows in deterministic newest-first order', async () => {
    queryMock.mockResolvedValue({ rows: [row] });

    await expect(listShoppingListItems('tenant-1', 'user-1')).resolves.toEqual([row]);

    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/where tenant_id = \$1 and user_id = \$2/);
    expect(sql).toMatch(/order by created_at desc, id desc/);
    expect(params).toEqual(['tenant-1', 'user-1']);
  });

  it('applies an optional status filter inside the tenant and user scope', async () => {
    queryMock.mockResolvedValue({ rows: [row] });

    await listShoppingListItems('tenant-1', 'user-1', { status: 'pending' });

    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/tenant_id = \$1 and user_id = \$2 and status = \$3/);
    expect(params).toEqual(['tenant-1', 'user-1', 'pending']);
  });

  it('creates only manually-sourced values without a premium recipe input', async () => {
    queryMock.mockResolvedValue({ rows: [row] });

    await expect(
      createShoppingListItem({
        tenantId: 'tenant-1',
        userId: 'user-1',
        ingredientName: 'Arroz',
        quantity: '1 kg',
        source: 'manual',
      })
    ).resolves.toEqual(row);

    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('insert into public.shopping_list_items');
    expect(sql).not.toContain('premium_recipe_id');
    expect(params).toEqual(['tenant-1', 'user-1', 'manual', 'Arroz', '1 kg']);
  });

  it('updates status only with id, tenant, and user predicates', async () => {
    queryMock.mockResolvedValue({ rows: [{ ...row, status: 'purchased' }] });

    await expect(
      updateShoppingListItemStatus('shopping-1', 'tenant-1', 'user-1', 'purchased')
    ).resolves.toEqual({ ...row, status: 'purchased' });

    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/where id = \$2 and tenant_id = \$3 and user_id = \$4/);
    expect(params).toEqual(['purchased', 'shopping-1', 'tenant-1', 'user-1']);
  });

  it('returns null when a scoped status update cannot access a row', async () => {
    queryMock.mockResolvedValue({ rows: [] });

    await expect(
      updateShoppingListItemStatus('other-user-item', 'tenant-1', 'user-1', 'purchased')
    ).resolves.toBeNull();
  });

  it('deletes only with id, tenant, and user predicates and returns null when inaccessible', async () => {
    queryMock.mockResolvedValueOnce({ rows: [row] }).mockResolvedValueOnce({ rows: [] });

    await expect(deleteShoppingListItem('shopping-1', 'tenant-1', 'user-1')).resolves.toEqual(row);
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/where id = \$1 and tenant_id = \$2 and user_id = \$3/);
    expect(params).toEqual(['shopping-1', 'tenant-1', 'user-1']);

    await expect(deleteShoppingListItem('other-user-item', 'tenant-1', 'user-1')).resolves.toBeNull();
  });
});
