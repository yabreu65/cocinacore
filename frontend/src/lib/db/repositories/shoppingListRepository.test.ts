import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const mapSingleRowMock = vi.fn();
const transactionMock = vi.fn();
const lockCalls: Array<{ client: unknown; sql: string; params: unknown[] }> = [];
const lockFailure = { error: null as Error | null };
function instrumentClient(query: typeof queryMock) {
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      if (
        sql === 'select pg_advisory_xact_lock(hashtextextended($1, 0))' &&
        typeof params[0] === 'string' &&
        params[0].startsWith('cocinacore:inventory-source:v1:')
      ) {
        lockCalls.push({ client, sql, params });
        if (lockFailure.error) throw lockFailure.error;
        return { rows: [] };
      }
      return query(sql, params) as unknown;
    },
  };
  return client as unknown as { query: typeof queryMock };
}
const scopedTransactionMock = vi.fn(
  async (
    _scope: unknown,
    callback: (client: { query: typeof queryMock }) => unknown
  ): Promise<unknown> => transactionMock(callback) as unknown
);
const createInventoryItemInTransactionMock = vi.fn();

vi.mock('@/lib/db', () => ({
  query: queryMock,
  mapSingleRow: mapSingleRowMock,
  transaction: transactionMock,
  scopedTransaction: scopedTransactionMock,
}));
vi.mock('@/lib/db/repositories/inventoryRepository', () => ({
  createInventoryItemInTransaction: createInventoryItemInTransactionMock,
}));

const {
  addMealPlanShoppingItems,
  transferPurchasedShoppingListItem,
  createShoppingListItem,
  confirmShoppingProductPurchase,
  deleteShoppingListItem,
  listShoppingListItems,
  updateShoppingListItemStatus,
} = await import('./shoppingListRepository');

const row = {
  id: 'shopping-1',
  tenant_id: '00000000-0000-4000-8000-000000000001',
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
  tenant_id: '00000000-0000-4000-8000-000000000001',
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
    lockCalls.length = 0;
    lockFailure.error = null;
    queryMock.mockReset();
    mapSingleRowMock.mockReset();
    transactionMock.mockReset();
    transactionMock.mockImplementation(
      async (
        callback: (client: { query: typeof queryMock }) => Promise<unknown>
      ): Promise<unknown> => callback(instrumentClient(queryMock))
    );
    scopedTransactionMock.mockReset();
    scopedTransactionMock.mockImplementation(
      async (
        _scope: unknown,
        callback: (client: { query: typeof queryMock }) => unknown
      ): Promise<unknown> => transactionMock(callback) as unknown
    );
    createInventoryItemInTransactionMock.mockReset();
    mapSingleRowMock.mockImplementation((result: { rows: unknown[] }) => result.rows[0] ?? null);
  });

  it('lists only authenticated tenant and user rows in deterministic newest-first order', async () => {
    queryMock.mockResolvedValue({ rows: [row] });

    await expect(
      listShoppingListItems('00000000-0000-4000-8000-000000000001', 'user-1')
    ).resolves.toEqual([row]);

    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/where sl\.tenant_id = \$1 and sl\.user_id = \$2/);
    expect(sql).toMatch(/order by sl\.created_at desc, sl\.id desc/);
    expect(params).toEqual(['00000000-0000-4000-8000-000000000001', 'user-1']);
  });

  it('uses one scoped client for HTTP list and rejects scope mismatch', async () => {
    queryMock.mockResolvedValue({ rows: [row] });
    const scope = { tenantId: '00000000-0000-4000-8000-000000000001', userId: 'user-1' };
    await expect(
      listShoppingListItems('00000000-0000-4000-8000-000000000001', 'user-1', {}, undefined, scope)
    ).resolves.toEqual([row]);
    expect(scopedTransactionMock).toHaveBeenCalledWith(scope, expect.any(Function));
    expect(queryMock).toHaveBeenCalledOnce();
    await expect(
      listShoppingListItems('00000000-0000-4000-8000-000000000001', 'user-1', {}, undefined, {
        ...scope,
        userId: 'other',
      })
    ).rejects.toThrow('Shopping scope mismatch');
  });

  it('applies an optional status filter inside the tenant and user scope', async () => {
    queryMock.mockResolvedValue({ rows: [row] });

    await listShoppingListItems('00000000-0000-4000-8000-000000000001', 'user-1', {
      status: 'pending',
    });

    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/sl\.tenant_id = \$1 and sl\.user_id = \$2 and sl\.status = \$3/);
    expect(params).toEqual(['00000000-0000-4000-8000-000000000001', 'user-1', 'pending']);
  });

  it('bounds list reads when the caller requests a fail-closed sentinel', async () => {
    queryMock.mockResolvedValue({ rows: [row] });

    await listShoppingListItems('00000000-0000-4000-8000-000000000001', 'user-1', {}, 501);

    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/limit \$3/);
    expect(params).toEqual(['00000000-0000-4000-8000-000000000001', 'user-1', 501]);
  });

  it('creates only manually-sourced values without a premium recipe input', async () => {
    queryMock.mockResolvedValue({ rows: [row] });

    await expect(
      createShoppingListItem({
        tenantId: '00000000-0000-4000-8000-000000000001',
        userId: 'user-1',
        ingredientName: 'Arroz',
        quantity: '1 kg',
        source: 'manual',
      })
    ).resolves.toEqual(row);

    expect(scopedTransactionMock).toHaveBeenCalledWith(
      { tenantId: '00000000-0000-4000-8000-000000000001', userId: 'user-1' },
      expect.any(Function)
    );
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('insert into public.shopping_list_items');
    expect(sql).not.toContain('premium_recipe_id');
    expect(params).toEqual([
      '00000000-0000-4000-8000-000000000001',
      'user-1',
      'manual',
      'Arroz',
      '1 kg',
    ]);
  });

  it('locks, reads scoped source rows, and inserts only absent normalized identities in one transaction', async () => {
    const clientQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({
        rows: [{ ...row, id: 'shopping-2', ingredient_name: 'Sal', quantity: null }],
      });
    scopedTransactionMock.mockImplementation(
      async (_scope: unknown, callback: (client: { query: typeof clientQuery }) => unknown) =>
        callback(instrumentClient(clientQuery))
    );

    const result = await addMealPlanShoppingItems({
      tenantId: '00000000-0000-4000-8000-000000000001',
      userId: 'user-1',
      source: 'meal-plan:plan-1',
      items: [
        { ingredientName: 'arroz', quantity: '2 kg' },
        { ingredientName: 'Sal', quantity: null },
      ],
    });

    expect(scopedTransactionMock).toHaveBeenCalledOnce();
    expect(scopedTransactionMock).toHaveBeenCalledWith(
      { tenantId: '00000000-0000-4000-8000-000000000001', userId: 'user-1' },
      expect.any(Function)
    );
    expect(transactionMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
    const clientQueries = clientQuery.mock.calls as unknown as Array<[string, ...unknown[]]>;
    expect(clientQueries.map(([sql]) => sql)).toEqual([
      'select pg_advisory_xact_lock(hashtextextended($1, 0))',
      expect.stringContaining('where tenant_id = $1 and user_id = $2 and source = $3'),
      expect.stringContaining('insert into public.shopping_list_items'),
    ]);
    expect(clientQuery.mock.calls[0]?.[1]).toEqual([
      '00000000-0000-4000-8000-000000000001:user-1:meal-plan:plan-1',
    ]);
    expect(clientQuery.mock.calls[1]?.[1]).toEqual([
      '00000000-0000-4000-8000-000000000001',
      'user-1',
      'meal-plan:plan-1',
    ]);
    expect(clientQuery.mock.calls[2]?.[1]).toEqual([
      '00000000-0000-4000-8000-000000000001',
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
    scopedTransactionMock.mockImplementation(
      async (_scope: unknown, callback: (client: { query: typeof clientQuery }) => unknown) =>
        callback(instrumentClient(clientQuery))
    );

    await expect(
      addMealPlanShoppingItems({
        tenantId: '00000000-0000-4000-8000-000000000001',
        userId: 'user-1',
        source: 'meal-plan:plan-2',
        dedupeScope: 'user',
        items: [{ ingredientName: ' ARROZ ', quantity: '2 kg' }],
      })
    ).resolves.toEqual({ added: [], alreadyPresent: [existingManual] });

    expect(clientQuery.mock.calls[0]?.[1]).toEqual([
      '00000000-0000-4000-8000-000000000001:user-1:shopping-list',
    ]);
    expect(clientQuery.mock.calls[1]?.[0]).toEqual(
      expect.stringContaining('where tenant_id = $1 and user_id = $2')
    );
    expect(clientQuery.mock.calls[1]?.[0]).not.toContain('source = $3');
    expect(clientQuery).toHaveBeenCalledTimes(2);
  });

  it('propagates a transaction failure without performing follow-up writes', async () => {
    const failure = new Error('insert failed');
    const clientQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(failure);
    scopedTransactionMock.mockImplementation(
      async (_scope: unknown, callback: (client: { query: typeof clientQuery }) => unknown) =>
        callback(instrumentClient(clientQuery))
    );

    await expect(
      addMealPlanShoppingItems({
        tenantId: '00000000-0000-4000-8000-000000000001',
        userId: 'user-1',
        source: 'meal-plan:plan-1',
        items: [{ ingredientName: 'Sal', quantity: null }],
      })
    ).rejects.toBe(failure);
    expect(clientQuery).toHaveBeenCalledTimes(3);
  });

  it('does not insert duplicates on retry or within the same request', async () => {
    const inserted = { ...row, id: 'shopping-2', ingredient_name: 'Sal', quantity: null };
    const clientQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [inserted] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [inserted] });
    scopedTransactionMock.mockImplementation(
      async (_scope: unknown, callback: (client: { query: typeof clientQuery }) => unknown) =>
        callback(instrumentClient(clientQuery))
    );
    const input = {
      tenantId: '00000000-0000-4000-8000-000000000001',
      userId: 'user-1',
      source: 'meal-plan:plan-1',
      items: [
        { ingredientName: 'Sal', quantity: null },
        { ingredientName: ' SAL ', quantity: null },
      ],
    };

    await expect(addMealPlanShoppingItems(input)).resolves.toEqual({
      added: [inserted],
      alreadyPresent: [],
    });
    await expect(addMealPlanShoppingItems(input)).resolves.toEqual({
      added: [],
      alreadyPresent: [inserted],
    });
    expect(clientQuery).toHaveBeenCalledTimes(5);
    expect(scopedTransactionMock).toHaveBeenCalledTimes(2);
    expect(transactionMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
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
        callback(instrumentClient(clientQuery))
    );
    createInventoryItemInTransactionMock.mockResolvedValue(inventoryItem);

    await expect(
      transferPurchasedShoppingListItem(
        'shopping-1',
        '00000000-0000-4000-8000-000000000001',
        'user-1'
      )
    ).resolves.toEqual({
      item: transferred,
      inventoryItem,
    });

    expect(transactionMock).toHaveBeenCalledOnce();
    expect(scopedTransactionMock).toHaveBeenCalledWith(
      { tenantId: '00000000-0000-4000-8000-000000000001', userId: 'user-1' },
      expect.any(Function)
    );
    expect(createInventoryItemInTransactionMock).toHaveBeenCalledWith(
      clientQuery.mock.calls.length ? expect.anything() : null,
      {
        tenantId: '00000000-0000-4000-8000-000000000001',
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
        callback(instrumentClient(replayClientQuery))
    );
    await expect(
      transferPurchasedShoppingListItem(
        'shopping-1',
        '00000000-0000-4000-8000-000000000001',
        'user-1'
      )
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
    { quantity: '1 1/2 kg', expectedQuantity: '1.5' },
    { quantity: '1 / 2 kg', expectedQuantity: '0.5' },
    { quantity: '0,5 kg', expectedQuantity: '0.5' },
    { quantity: '0.0001 kg', expectedQuantity: '0.0001' },
    { quantity: '1/10000 kg', expectedQuantity: '0.0001' },
    { quantity: '99999999.9999 kg', expectedQuantity: '99999999.9999' },
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
          callback(instrumentClient(clientQuery))
      );
      createInventoryItemInTransactionMock.mockResolvedValue(inventoryItem);

      await transferPurchasedShoppingListItem(
        'shopping-1',
        '00000000-0000-4000-8000-000000000001',
        'user-1'
      );

      expect(createInventoryItemInTransactionMock).toHaveBeenCalledWith(expect.anything(), {
        tenantId: '00000000-0000-4000-8000-000000000001',
        userId: 'user-1',
        ingredientName: 'Arroz',
        quantity: expectedQuantity,
        unit: 'kg',
        category: 'Granos',
        normalizedName: 'arroz',
      });
      expect(clientQuery).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('insert into public.inventory_movements'),
        [row.tenant_id, row.user_id, inventoryItem.id, expectedQuantity, 'kg', 'arroz']
      );
    }
  );

  it('rejects an explicitly unsupported purchased quantity without creating inventory', async () => {
    const clientQuery = vi.fn().mockResolvedValue({
      rows: [{ ...row, status: 'purchased' as const, quantity: '1 bolsa' }],
    });
    transactionMock.mockImplementation(
      async (callback: (client: { query: typeof clientQuery }) => unknown) =>
        callback(instrumentClient(clientQuery))
    );

    await expect(
      transferPurchasedShoppingListItem(
        'shopping-1',
        '00000000-0000-4000-8000-000000000001',
        'user-1'
      )
    ).rejects.toThrow();
    expect(clientQuery).toHaveBeenCalledOnce();
    expect(createInventoryItemInTransactionMock).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'pending' as const, quantity: '1 kg', expected: /purchased/ },
    { status: 'purchased' as const, quantity: null, expected: /quantity/i },
    { status: 'purchased' as const, quantity: 'al gusto', expected: /quantity/i },
    { status: 'purchased' as const, quantity: '3', expected: /quantity/i },
    ...[
      '1 1/2',
      '1 / 2',
      '1/2',
      '1 kg extra',
      '1 tomates',
      '1/0 kg',
      '0 kg',
      '1 constructor',
      '1/3 kg',
      '0.00001 kg',
      '1/100000 kg',
      '0.00015 kg',
      '100000000 kg',
      '99999999.99995 kg',
      '1.00000000000000000001 kg',
    ].map((quantity) => ({ status: 'purchased' as const, quantity, expected: /quantity/i })),
  ])(
    'rejects untransferable shopping rows without writes',
    async ({ status, quantity, expected }) => {
      const clientQuery = vi.fn().mockResolvedValue({ rows: [{ ...row, status, quantity }] });
      transactionMock.mockImplementation(
        async (callback: (client: { query: typeof clientQuery }) => unknown) =>
          callback(instrumentClient(clientQuery))
      );

      await expect(
        transferPurchasedShoppingListItem(
          'shopping-1',
          '00000000-0000-4000-8000-000000000001',
          'user-1'
        )
      ).rejects.toThrow(expected);
      expect(clientQuery).toHaveBeenCalledOnce();
      expect(createInventoryItemInTransactionMock).not.toHaveBeenCalled();
    }
  );

  it('does not persist a transfer marker when recording its movement fails', async () => {
    const purchased = { ...row, status: 'purchased' as const };
    const clientQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [purchased] })
      .mockRejectedValueOnce(new Error('movement insert failed'));
    transactionMock.mockImplementation(
      async (callback: (client: { query: typeof clientQuery }) => unknown) =>
        callback(instrumentClient(clientQuery))
    );
    createInventoryItemInTransactionMock.mockResolvedValue(inventoryItem);

    await expect(
      transferPurchasedShoppingListItem(
        'shopping-1',
        '00000000-0000-4000-8000-000000000001',
        'user-1'
      )
    ).rejects.toThrow('movement insert failed');
    expect(clientQuery).toHaveBeenCalledTimes(2);
    expect(clientQuery.mock.calls[1]?.[0]).toContain('insert into public.inventory_movements');
  });

  it('returns null for rows outside the authenticated tenant and user scope', async () => {
    const clientQuery = vi.fn().mockResolvedValue({ rows: [] });
    transactionMock.mockImplementation(
      async (callback: (client: { query: typeof clientQuery }) => unknown) =>
        callback(instrumentClient(clientQuery))
    );

    await expect(
      transferPurchasedShoppingListItem(
        'shopping-1',
        '00000000-0000-4000-8000-000000000002',
        'user-2'
      )
    ).resolves.toBeNull();
    expect(clientQuery).toHaveBeenCalledOnce();
    expect(createInventoryItemInTransactionMock).not.toHaveBeenCalled();
  });

  it('updates status only with id, tenant, and user predicates', async () => {
    queryMock.mockResolvedValue({ rows: [{ ...row, status: 'purchased' }] });

    await expect(
      updateShoppingListItemStatus(
        'shopping-1',
        '00000000-0000-4000-8000-000000000001',
        'user-1',
        'purchased'
      )
    ).resolves.toEqual({ ...row, status: 'purchased' });

    expect(scopedTransactionMock).toHaveBeenCalledWith(
      { tenantId: '00000000-0000-4000-8000-000000000001', userId: 'user-1' },
      expect.any(Function)
    );
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/where id = \$2 and tenant_id = \$3 and user_id = \$4/);
    expect(params).toEqual([
      'purchased',
      'shopping-1',
      '00000000-0000-4000-8000-000000000001',
      'user-1',
    ]);
  });

  it('returns null when a scoped status update cannot access a row', async () => {
    queryMock.mockResolvedValue({ rows: [] });

    await expect(
      updateShoppingListItemStatus(
        'other-user-item',
        '00000000-0000-4000-8000-000000000001',
        'user-1',
        'purchased'
      )
    ).resolves.toBeNull();
  });

  it('deletes only with id, tenant, and user predicates and returns null when inaccessible', async () => {
    queryMock.mockResolvedValueOnce({ rows: [row] }).mockResolvedValueOnce({ rows: [] });

    await expect(
      deleteShoppingListItem('shopping-1', '00000000-0000-4000-8000-000000000001', 'user-1')
    ).resolves.toEqual(row);
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/where id = \$1 and tenant_id = \$2 and user_id = \$3/);
    expect(params).toEqual(['shopping-1', '00000000-0000-4000-8000-000000000001', 'user-1']);

    await expect(
      deleteShoppingListItem('other-user-item', '00000000-0000-4000-8000-000000000001', 'user-1')
    ).resolves.toBeNull();
  });
  it.each(['create', 'add', 'transfer', 'status', 'delete'] as const)(
    'acquires the shared tenant lock before any %s business query and stops on lock failure',
    async (operation) => {
      const tenantId = '00000000-0000-4000-8000-000000000001';
      const userId = 'user-1';
      lockFailure.error = new Error('tenant lock failed');
      const actions = {
        create: () =>
          createShoppingListItem({ tenantId, userId, ingredientName: 'Arroz', source: 'manual' }),
        add: () =>
          addMealPlanShoppingItems({
            tenantId,
            userId,
            source: 'meal-plan:plan-1',
            items: [{ ingredientName: 'Arroz', quantity: '1 kg' }],
          }),
        transfer: () => transferPurchasedShoppingListItem('shopping-1', tenantId, userId),
        status: () => updateShoppingListItemStatus('shopping-1', tenantId, userId, 'purchased'),
        delete: () => deleteShoppingListItem('shopping-1', tenantId, userId),
      };
      await expect(actions[operation]()).rejects.toThrow('tenant lock failed');
      expect(lockCalls).toHaveLength(1);
      expect(lockCalls[0]?.params).toEqual([`cocinacore:inventory-source:v1:${tenantId}`]);
      expect(queryMock).not.toHaveBeenCalled();
      expect(createInventoryItemInTransactionMock).not.toHaveBeenCalled();
    }
  );

  it('prevents undoing or deleting rows already transferred to inventory', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await expect(
      updateShoppingListItemStatus('shopping-1', row.tenant_id, row.user_id, 'pending')
    ).resolves.toBeNull();
    const statusSql = queryMock.mock.calls[0]?.[0] as string;
    expect(statusSql).toContain("($1 = 'purchased' or transfer_inventory_item_id is null)");
    await expect(
      deleteShoppingListItem('shopping-1', row.tenant_id, row.user_id)
    ).resolves.toBeNull();
    expect(queryMock.mock.calls[1]?.[0]).toContain('transfer_inventory_item_id is null');
  });

  const groupRows = [
    {
      ...row,
      id: '00000000-0000-4000-8000-000000000011',
      ingredient_name: 'Huevo',
      quantity: '11 unidad',
    },
    {
      ...row,
      id: '00000000-0000-4000-8000-000000000012',
      ingredient_name: 'Huevos',
      quantity: '15 unidad',
    },
  ];

  function purchaseInput(actualQuantity = '30 unidad') {
    return {
      tenantId: row.tenant_id,
      userId: row.user_id,
      groupKey: 'pending:huevos',
      rows: groupRows.map((item) => ({
        id: item.id,
        ingredientName: item.ingredient_name,
        quantity: item.quantity,
      })),
      actualQuantity,
    };
  }

  it('atomically records one actual carton of 30 for 26 required eggs and marks both original rows', async () => {
    const purchased = groupRows.map((item) => ({
      ...item,
      status: 'purchased' as const,
      transfer_inventory_item_id: inventoryItem.id,
      transferred_at: '2026-11-21T00:00:00.000Z',
    }));
    queryMock
      .mockResolvedValueOnce({ rows: groupRows })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: purchased });
    createInventoryItemInTransactionMock.mockResolvedValue(inventoryItem);

    const result = await confirmShoppingProductPurchase(purchaseInput());
    expect(result.items).toEqual(purchased);
    expect(result.inventoryItem).toEqual(inventoryItem);
    expect(scopedTransactionMock).toHaveBeenCalledWith(
      { tenantId: row.tenant_id, userId: row.user_id },
      expect.any(Function),
      { isolationLevel: 'read committed' }
    );
    expect(lockCalls).toHaveLength(1);
    expect(createInventoryItemInTransactionMock).toHaveBeenCalledOnce();
    expect(createInventoryItemInTransactionMock.mock.calls[0]?.[0]).toBe(lockCalls[0]?.client);
    expect(createInventoryItemInTransactionMock.mock.calls[0]?.[1]).toMatchObject({
      ingredientName: 'Huevos',
      quantity: '30',
      unit: 'unidad',
      normalizedName: 'huevos',
    });
    expect(queryMock).toHaveBeenCalledTimes(3);
    expect(queryMock.mock.calls[0]?.[0]).toContain('order by id for update');
    expect(queryMock.mock.calls[0]?.[1]).toEqual([row.tenant_id, row.user_id]);
    expect(queryMock.mock.calls[1]?.[0]).toContain('insert into public.inventory_movements');
    expect(queryMock.mock.calls[1]?.[1]).toEqual([
      row.tenant_id,
      row.user_id,
      inventoryItem.id,
      '30',
      'unidad',
      'huevos',
    ]);
    expect(queryMock.mock.calls[2]?.[0]).toContain("status = 'purchased'");
    expect(queryMock.mock.calls[2]?.[1]).toEqual([
      inventoryItem.id,
      row.tenant_id,
      row.user_id,
      groupRows.map((item) => item.id),
    ]);
  });

  it('transfers the real purchased 1kg of rice while preserving a 700g source row', async () => {
    const rice = { ...groupRows[0], ingredient_name: 'Arroz blanco', quantity: '700 g' };
    queryMock
      .mockResolvedValueOnce({ rows: [rice] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...rice, status: 'purchased' }] });
    createInventoryItemInTransactionMock.mockResolvedValue(inventoryItem);
    await confirmShoppingProductPurchase({
      tenantId: row.tenant_id,
      userId: row.user_id,
      groupKey: 'pending:arroz blanco',
      rows: [{ id: rice.id, ingredientName: rice.ingredient_name, quantity: rice.quantity }],
      actualQuantity: '1 kg',
    });
    expect(createInventoryItemInTransactionMock.mock.calls[0]?.[1]).toMatchObject({
      quantity: '1000',
      unit: 'g',
      ingredientName: 'Arroz blanco',
    });
    const movementValues = queryMock.mock.calls[1]?.[1] as unknown[] | undefined;
    expect(movementValues?.[3]).toBe('1000');
    expect(rice.quantity).toBe('700 g');
  });

  it.each([
    ['stale', () => ({ rows: groupRows.slice(0, 1), input: purchaseInput() })],
    [
      'stale',
      () => ({
        rows: groupRows,
        input: {
          ...purchaseInput(),
          rows: purchaseInput().rows.map((r, index) =>
            index ? { ...r, quantity: '20 unidad' } : r
          ),
        },
      }),
    ],
    ['stale', () => ({ rows: [], input: purchaseInput() })],
    ['insufficient', () => ({ rows: groupRows, input: purchaseInput('25 unidad') })],
    ['invalid_quantity', () => ({ rows: groupRows, input: purchaseInput('1 kg') })],
    [
      'ambiguous',
      () => ({
        rows: [
          { ...groupRows[0], quantity: '11 unidad' },
          { ...groupRows[1], quantity: null },
        ],
        input: {
          ...purchaseInput(),
          rows: purchaseInput().rows.map((r, index) => (index ? { ...r, quantity: null } : r)),
        },
      }),
    ],
  ] as const)('rejects %s before creating inventory or a movement', async (code, setup) => {
    const { rows, input } = setup();
    queryMock.mockResolvedValue({ rows });
    await expect(confirmShoppingProductPurchase(input)).rejects.toMatchObject({
      name: 'ShoppingGroupPurchaseError',
      code,
    });
    expect(createInventoryItemInTransactionMock).not.toHaveBeenCalled();
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed if updated row count differs after inventory insert, for transaction rollback', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: groupRows })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [groupRows[0]] });
    createInventoryItemInTransactionMock.mockResolvedValue(inventoryItem);
    await expect(confirmShoppingProductPurchase(purchaseInput())).rejects.toMatchObject({
      code: 'stale',
    });
    expect(scopedTransactionMock).toHaveBeenCalledOnce();
  });

  it('stops on shared tenant lock failure before reading any shopping rows', async () => {
    lockFailure.error = new Error('tenant lock failed');
    await expect(confirmShoppingProductPurchase(purchaseInput())).rejects.toThrow(
      'tenant lock failed'
    );
    expect(queryMock).not.toHaveBeenCalled();
    expect(createInventoryItemInTransactionMock).not.toHaveBeenCalled();
  });

  it('uses the same transaction client for the tenant lock and the purchase transfer', async () => {
    const purchased = { ...row, status: 'purchased' };
    queryMock
      .mockResolvedValueOnce({ rows: [purchased] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [purchased] });
    createInventoryItemInTransactionMock.mockResolvedValue(inventoryItem);
    await transferPurchasedShoppingListItem('shopping-1', row.tenant_id, row.user_id);
    expect(lockCalls).toHaveLength(1);
    expect(createInventoryItemInTransactionMock.mock.calls[0]?.[0]).toBe(lockCalls[0]?.client);
  });
});
