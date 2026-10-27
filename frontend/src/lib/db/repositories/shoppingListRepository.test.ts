import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const mapSingleRowMock = vi.fn();
const transactionMock = vi.fn();
const createInventoryItemInTransactionMock = vi.fn();

vi.mock('@/lib/db', () => ({
  query: queryMock,
  mapSingleRow: mapSingleRowMock,
  transaction: transactionMock,
}));
vi.mock('@/lib/db/repositories/inventoryRepository', () => ({
  createInventoryItemInTransaction: createInventoryItemInTransactionMock,
}));

const {
  addMealPlanShoppingItems,
  transferPurchasedShoppingListItem,
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
  transfer_inventory_item_id: null,
  transferred_at: null,
};

const inventoryItem = {
  id: 'inventory-1',
  tenant_id: 'tenant-1',
  user_id: 'user-1',
  ingredient_name: 'Arroz',
  quantity: '1',
  unit: 'kg',
  category: 'Granos',
  expiration_date: null,
  estimated_unit_price: null,
  purchase_location: null,
  low_stock_threshold: null,
  normalized_name: 'arroz',
  notes: null,
  created_at: '2026-03-16T00:00:00.000Z',
  updated_at: '2026-03-16T00:00:00.000Z',
};

describe('shoppingListRepository', () => {
  beforeEach(() => {
    queryMock.mockReset();
    mapSingleRowMock.mockReset();
    transactionMock.mockReset();
    createInventoryItemInTransactionMock.mockReset();
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

  it('bounds list reads when the caller requests a fail-closed sentinel', async () => {
    queryMock.mockResolvedValue({ rows: [row] });

    await listShoppingListItems('tenant-1', 'user-1', {}, 501);

    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/limit \$3/);
    expect(params).toEqual(['tenant-1', 'user-1', 501]);
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

  it('locks, reads scoped source rows, and inserts only absent normalized identities in one transaction', async () => {
    const clientQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({
        rows: [{ ...row, id: 'shopping-2', ingredient_name: 'Sal', quantity: null }],
      });
    transactionMock.mockImplementation(
      async (callback: (client: { query: typeof clientQuery }) => unknown) =>
        callback({ query: clientQuery })
    );

    const result = await addMealPlanShoppingItems({
      tenantId: 'tenant-1',
      userId: 'user-1',
      source: 'meal-plan:plan-1',
      items: [
        { ingredientName: 'arroz', quantity: '2 kg' },
        { ingredientName: 'Sal', quantity: null },
      ],
    });

    expect(transactionMock).toHaveBeenCalledOnce();
    const clientQueries = clientQuery.mock.calls as unknown as Array<[string, ...unknown[]]>;
    expect(clientQueries.map(([sql]) => sql)).toEqual([
      'select pg_advisory_xact_lock(hashtextextended($1, 0))',
      expect.stringContaining('where tenant_id = $1 and user_id = $2 and source = $3'),
      expect.stringContaining('insert into public.shopping_list_items'),
    ]);
    expect(clientQuery.mock.calls[0]?.[1]).toEqual(['tenant-1:user-1:meal-plan:plan-1']);
    expect(clientQuery.mock.calls[1]?.[1]).toEqual(['tenant-1', 'user-1', 'meal-plan:plan-1']);
    expect(clientQuery.mock.calls[2]?.[1]).toEqual([
      'tenant-1',
      'user-1',
      'meal-plan:plan-1',
      'Sal',
      null,
    ]);
    expect(result).toEqual({
      added: [{ ...row, id: 'shopping-2', ingredient_name: 'Sal', quantity: null }],
      alreadyPresent: [row],
    });
  });

  it('can lock and deduplicate against every source without modifying existing rows', async () => {
    const existingManual = { ...row, source: 'manual' };
    const clientQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [existingManual] });
    transactionMock.mockImplementation(
      async (callback: (client: { query: typeof clientQuery }) => unknown) =>
        callback({ query: clientQuery })
    );

    await expect(
      addMealPlanShoppingItems({
        tenantId: 'tenant-1',
        userId: 'user-1',
        source: 'meal-plan:plan-2',
        dedupeScope: 'user',
        items: [{ ingredientName: ' ARROZ ', quantity: '2 kg' }],
      })
    ).resolves.toEqual({ added: [], alreadyPresent: [existingManual] });

    expect(clientQuery.mock.calls[0]?.[1]).toEqual(['tenant-1:user-1:shopping-list']);
    expect(clientQuery.mock.calls[1]?.[0]).toEqual(
      expect.stringContaining('where tenant_id = $1 and user_id = $2')
    );
    expect(clientQuery.mock.calls[1]?.[0]).not.toContain('source = $3');
    expect(clientQuery).toHaveBeenCalledTimes(2);
  });

  it('propagates a transaction failure without performing follow-up writes', async () => {
    const failure = new Error('insert failed');
    const clientQuery = vi.fn().mockRejectedValue(failure);
    transactionMock.mockImplementation(
      async (callback: (client: { query: typeof clientQuery }) => unknown) =>
        callback({ query: clientQuery })
    );

    await expect(
      addMealPlanShoppingItems({
        tenantId: 'tenant-1',
        userId: 'user-1',
        source: 'meal-plan:plan-1',
        items: [{ ingredientName: 'Sal', quantity: null }],
      })
    ).rejects.toBe(failure);
    expect(clientQuery).toHaveBeenCalledOnce();
  });

  it('atomically transfers purchased rows and returns the existing inventory item on replay', async () => {
    const purchased = { ...row, status: 'purchased' as const };
    const transferred = {
      ...purchased,
      transfer_inventory_item_id: inventoryItem.id,
      transferred_at: '2026-03-16T00:00:00.000Z',
    };
    const clientQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [purchased] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [transferred] });
    transactionMock.mockImplementation(
      async (callback: (client: { query: typeof clientQuery }) => unknown) =>
        callback({ query: clientQuery })
    );
    createInventoryItemInTransactionMock.mockResolvedValue(inventoryItem);

    await expect(
      transferPurchasedShoppingListItem('shopping-1', 'tenant-1', 'user-1')
    ).resolves.toEqual({
      item: transferred,
      inventoryItem,
    });

    expect(transactionMock).toHaveBeenCalledOnce();
    expect(createInventoryItemInTransactionMock).toHaveBeenCalledWith(
      clientQuery.mock.calls.length ? expect.anything() : null,
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        ingredientName: 'Arroz',
        quantity: '1',
        unit: 'kg',
        category: 'Granos',
        normalizedName: 'arroz',
      }
    );
    expect(
      clientQuery.mock.calls.map(([sql]) => {
        if (typeof sql !== 'string') {
          throw new TypeError('Expected SQL query argument to be a string');
        }

        return sql;
      })
    ).toEqual([
      expect.stringContaining('for update'),
      expect.stringContaining('insert into public.inventory_movements'),
      expect.stringContaining('update public.shopping_list_items'),
    ]);

    const replayClientQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [transferred] })
      .mockResolvedValueOnce({ rows: [inventoryItem] });
    transactionMock.mockImplementationOnce(
      async (callback: (client: { query: typeof replayClientQuery }) => unknown) =>
        callback({ query: replayClientQuery })
    );
    await expect(
      transferPurchasedShoppingListItem('shopping-1', 'tenant-1', 'user-1')
    ).resolves.toEqual({
      item: transferred,
      inventoryItem,
    });
    expect(createInventoryItemInTransactionMock).toHaveBeenCalledOnce();
    expect(replayClientQuery).toHaveBeenCalledTimes(2);
  });

  it.each([
    { quantity: '4 kilos', expectedQuantity: '4' },
    { quantity: '1 kilo', expectedQuantity: '1' },
  ])(
    'transfers an existing purchased row with quantity "$quantity" as $expectedQuantity kg',
    async ({ quantity, expectedQuantity }) => {
      const purchased = { ...row, status: 'purchased' as const, quantity };
      const clientQuery = vi
        .fn()
        .mockResolvedValueOnce({ rows: [purchased] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              ...purchased,
              transfer_inventory_item_id: inventoryItem.id,
              transferred_at: '2026-03-16T00:00:00.000Z',
            },
          ],
        });
      transactionMock.mockImplementation(
        async (callback: (client: { query: typeof clientQuery }) => unknown) =>
          callback({ query: clientQuery })
      );
      createInventoryItemInTransactionMock.mockResolvedValue(inventoryItem);

      await transferPurchasedShoppingListItem('shopping-1', 'tenant-1', 'user-1');

      expect(createInventoryItemInTransactionMock).toHaveBeenCalledWith(expect.anything(), {
        tenantId: 'tenant-1',
        userId: 'user-1',
        ingredientName: 'Arroz',
        quantity: expectedQuantity,
        unit: 'kg',
        category: 'Granos',
        normalizedName: 'arroz',
      });
    }
  );

  it('rejects an explicitly unsupported purchased quantity without creating inventory', async () => {
    const clientQuery = vi.fn().mockResolvedValue({
      rows: [{ ...row, status: 'purchased' as const, quantity: '1 bolsa' }],
    });
    transactionMock.mockImplementation(
      async (callback: (client: { query: typeof clientQuery }) => unknown) =>
        callback({ query: clientQuery })
    );

    await expect(
      transferPurchasedShoppingListItem('shopping-1', 'tenant-1', 'user-1')
    ).rejects.toThrow();
    expect(clientQuery).toHaveBeenCalledOnce();
    expect(createInventoryItemInTransactionMock).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'pending' as const, quantity: '1 kg', expected: /purchased/ },
    { status: 'purchased' as const, quantity: null, expected: /quantity/i },
    { status: 'purchased' as const, quantity: 'al gusto', expected: /quantity/i },
    { status: 'purchased' as const, quantity: '3', expected: /quantity/i },
  ])('rejects untransferable shopping rows without writes', async ({ status, quantity }) => {
    const clientQuery = vi.fn().mockResolvedValue({ rows: [{ ...row, status, quantity }] });
    transactionMock.mockImplementation(
      async (callback: (client: { query: typeof clientQuery }) => unknown) =>
        callback({ query: clientQuery })
    );

    await expect(
      transferPurchasedShoppingListItem('shopping-1', 'tenant-1', 'user-1')
    ).rejects.toThrow();
    expect(clientQuery).toHaveBeenCalledOnce();
    expect(createInventoryItemInTransactionMock).not.toHaveBeenCalled();
  });

  it('does not persist a transfer marker when recording its movement fails', async () => {
    const purchased = { ...row, status: 'purchased' as const };
    const clientQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [purchased] })
      .mockRejectedValueOnce(new Error('movement insert failed'));
    transactionMock.mockImplementation(
      async (callback: (client: { query: typeof clientQuery }) => unknown) =>
        callback({ query: clientQuery })
    );
    createInventoryItemInTransactionMock.mockResolvedValue(inventoryItem);

    await expect(
      transferPurchasedShoppingListItem('shopping-1', 'tenant-1', 'user-1')
    ).rejects.toThrow('movement insert failed');
    expect(clientQuery).toHaveBeenCalledTimes(2);
    expect(clientQuery.mock.calls[1]?.[0]).toContain('insert into public.inventory_movements');
  });

  it('returns null for rows outside the authenticated tenant and user scope', async () => {
    const clientQuery = vi.fn().mockResolvedValue({ rows: [] });
    transactionMock.mockImplementation(
      async (callback: (client: { query: typeof clientQuery }) => unknown) =>
        callback({ query: clientQuery })
    );

    await expect(
      transferPurchasedShoppingListItem('shopping-1', 'tenant-2', 'user-2')
    ).resolves.toBeNull();
    expect(clientQuery).toHaveBeenCalledOnce();
    expect(createInventoryItemInTransactionMock).not.toHaveBeenCalled();
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

    await expect(
      deleteShoppingListItem('other-user-item', 'tenant-1', 'user-1')
    ).resolves.toBeNull();
  });
});
