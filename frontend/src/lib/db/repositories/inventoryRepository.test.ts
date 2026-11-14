import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const scopedTransactionMock = vi.fn();
const lockSql = 'select pg_advisory_xact_lock(hashtextextended($1, 0))';
const lockParams = ['cocinacore:inventory-source:v1:00000000-0000-4000-8000-000000000001'];
vi.mock('@/lib/db', () => ({
  query: queryMock,
  mapSingleRow: vi.fn(),
  scopedTransaction: scopedTransactionMock,
}));

const { listTodayInventoryContextByTenant, listWastePreventionInventoryByTenant } =
  await import('./inventoryRepository');

it('creates inventory on the scoped transaction client with actor and tenant', async () => {
  const { createInventoryItem } = await import('./inventoryRepository');
  const client = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'item-1' }] }) };
  scopedTransactionMock.mockImplementation(
    async (
      _scope: unknown,
      callback: (connection: typeof client) => Promise<unknown>
    ): Promise<unknown> => callback(client)
  );
  const input = {
    tenantId: '00000000-0000-4000-8000-000000000001',
    userId: 'user-1',
    ingredientName: 'Rice',
  };
  await expect(createInventoryItem(input)).resolves.toEqual({ id: 'item-1' });
  expect(scopedTransactionMock).toHaveBeenCalledWith(
    { tenantId: input.tenantId, userId: input.userId },
    expect.any(Function)
  );
  expect(client.query).toHaveBeenNthCalledWith(1, lockSql, lockParams);
  expect(client.query).toHaveBeenNthCalledWith(
    2,
    expect.stringContaining('insert into public.recipe_inventory_items'),
    expect.arrayContaining([input.tenantId, input.userId])
  );
});

describe('listTodayInventoryContextByTenant', () => {
  beforeEach(() => queryMock.mockReset());

  it('selects only context columns, tenant-scopes, filters by asOf and caps a parameterized limit', async () => {
    const rows = [
      {
        tenant_id: '00000000-0000-4000-8000-000000000001',
        ingredient_name: 'tomato',
        quantity: '2',
        unit: 'each',
        expiration_date: '2025-04-12',
      },
    ];
    queryMock.mockResolvedValue({ rows });
    const result = await listTodayInventoryContextByTenant(
      '00000000-0000-4000-8000-000000000001',
      '2025-04-10',
      500
    );
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(
      /select\s+tenant_id,\s*ingredient_name,\s*quantity,\s*unit,\s*expiration_date/i
    );
    expect(result).toEqual(rows);
    expect(result[0].tenant_id).toBe('00000000-0000-4000-8000-000000000001');
    expect(sql).toContain('tenant_id = $1');
    expect(sql).toMatch(/expiration_date\s+is null\s+or\s+expiration_date\s*>=\s*\$2/i);
    expect(sql).toMatch(/order by expiration_date asc nulls last/i);
    expect(sql).toMatch(/limit \$3/i);
    expect(sql).not.toMatch(/select\s+\*/i);
    expect(params).toEqual(['00000000-0000-4000-8000-000000000001', '2025-04-10', 50]);
  });

  it('runs the same tenant-shared date-limited projection on the scoped client', async () => {
    const rows = [
      {
        tenant_id: '00000000-0000-4000-8000-000000000001',
        ingredient_name: 'tomato',
        quantity: '2',
        unit: 'each',
        expiration_date: '2025-04-12',
      },
    ];
    const client = { query: vi.fn().mockResolvedValue({ rows }) };
    scopedTransactionMock
      .mockReset()
      .mockImplementation(
        async (_scope: unknown, callback: (connection: typeof client) => Promise<unknown>) =>
          callback(client)
      );
    const scope = { tenantId: '00000000-0000-4000-8000-000000000001', userId: 'user-1' };
    await expect(
      listTodayInventoryContextByTenant(
        '00000000-0000-4000-8000-000000000001',
        '2025-04-10',
        500,
        scope
      )
    ).resolves.toEqual(rows);
    expect(scopedTransactionMock).toHaveBeenCalledOnce();
    expect(scopedTransactionMock).toHaveBeenCalledWith(scope, expect.any(Function));
    expect(queryMock).not.toHaveBeenCalled();
    const [sql, params] = client.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(
      /select\s+tenant_id,\s*ingredient_name,\s*quantity,\s*unit,\s*expiration_date/i
    );
    expect(sql).toMatch(
      /tenant_id = \$1 and \(expiration_date is null or expiration_date >= \$2\)/i
    );
    expect(sql).toMatch(/order by expiration_date asc nulls last/i);
    expect(sql).toMatch(/limit \$3/i);
    expect(sql).not.toMatch(/user_id\s*=/i);
    expect(params).toEqual(['00000000-0000-4000-8000-000000000001', '2025-04-10', 50]);
    await expect(
      listTodayInventoryContextByTenant('other', '2025-04-10', 50, scope)
    ).rejects.toThrow('Inventory scope mismatch');
    expect(scopedTransactionMock).toHaveBeenCalledOnce();
    expect(client.query).toHaveBeenCalledOnce();
  });

  it('bounds small and invalid limits to a positive maximum-safe value', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await listTodayInventoryContextByTenant(
      '00000000-0000-4000-8000-000000000001',
      '2025-04-10',
      0
    );
    expect((queryMock.mock.calls[0] as [string, unknown[]])[1][2]).toBe(1);
  });
});

describe('listWastePreventionInventoryByTenant', () => {
  beforeEach(() => queryMock.mockReset());

  it('reads bounded tenant inventory without filtering away unknown or expired lots', async () => {
    const rows = [
      {
        id: 'lot-1',
        tenant_id: '00000000-0000-4000-8000-000000000001',
        user_id: 'user-1',
        ingredient_name: 'Tomate',
        quantity: '2',
        unit: 'unidad',
        category: 'Verduras',
        expiration_date: '2026-10-28',
        estimated_unit_price: null,
        purchase_location: null,
        low_stock_threshold: null,
        normalized_name: 'tomate',
        notes: null,
        created_at: '2026-10-20T00:00:00.000Z',
        updated_at: '2026-10-20T00:00:00.000Z',
      },
    ];
    queryMock.mockResolvedValue({ rows });

    const result = await listWastePreventionInventoryByTenant(
      '00000000-0000-4000-8000-000000000001',
      500
    );

    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(result).toEqual(rows);
    expect(sql).toContain('tenant_id = $1');
    expect(sql).toMatch(/order by expiration_date asc nulls last, created_at asc, id asc/i);
    expect(sql).toMatch(/limit \$2/i);
    expect(params).toEqual(['00000000-0000-4000-8000-000000000001', 101]);
  });

  it('uses the scoped client, retains tenant-shared ordering and sentinel, and rejects mismatches', async () => {
    const rows = [{ id: 'lot-1', user_id: 'another-user' }];
    const client = { query: vi.fn().mockResolvedValue({ rows }) };
    scopedTransactionMock
      .mockReset()
      .mockImplementation(
        async (_scope: unknown, callback: (connection: typeof client) => Promise<unknown>) =>
          callback(client)
      );
    const scope = { tenantId: '00000000-0000-4000-8000-000000000001', userId: 'user-1' };

    await expect(
      listWastePreventionInventoryByTenant('00000000-0000-4000-8000-000000000001', 500, scope)
    ).resolves.toEqual(rows);
    expect(scopedTransactionMock).toHaveBeenCalledOnce();
    expect(scopedTransactionMock).toHaveBeenCalledWith(scope, expect.any(Function));
    expect(queryMock).not.toHaveBeenCalled();
    const [sql, params] = client.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('where tenant_id = $1');
    expect(sql).not.toMatch(/user_id\s*=/i);
    expect(sql).toMatch(/order by expiration_date asc nulls last, created_at asc, id asc/i);
    expect(sql).toMatch(/limit \$2/i);
    expect(params).toEqual(['00000000-0000-4000-8000-000000000001', 101]);
    await expect(listWastePreventionInventoryByTenant('other', 100, scope)).rejects.toThrow(
      'Inventory scope mismatch'
    );
    expect(scopedTransactionMock).toHaveBeenCalledOnce();
    expect(client.query).toHaveBeenCalledOnce();
  });

  it('keeps the read limit positive and bounded', async () => {
    queryMock.mockResolvedValue({ rows: [] });

    await listWastePreventionInventoryByTenant('00000000-0000-4000-8000-000000000001', 0);

    expect((queryMock.mock.calls[0] as [string, unknown[]])[1][1]).toBe(2);
  });
});

it('executes list, update and delete through the scoped client', async () => {
  const { listInventoryItemsScoped, updateInventoryItem, deleteInventoryItem } =
    await import('./inventoryRepository');
  const client = { query: vi.fn().mockResolvedValue({ rows: [] }) };
  scopedTransactionMock.mockClear();
  scopedTransactionMock.mockImplementation(
    async (
      _scope: unknown,
      callback: (connection: typeof client) => Promise<unknown>
    ): Promise<unknown> => callback(client)
  );
  const scope = { tenantId: '00000000-0000-4000-8000-000000000001', userId: 'user-1' };
  await listInventoryItemsScoped(scope);
  await updateInventoryItem('item-1', scope.tenantId, { ingredientName: 'Rice' }, scope);
  await deleteInventoryItem('item-1', scope.tenantId, scope);
  expect(scopedTransactionMock).toHaveBeenCalledTimes(3);
  for (const n of [1, 2])
    expect(scopedTransactionMock).toHaveBeenNthCalledWith(n, scope, expect.any(Function));
  expect(scopedTransactionMock).toHaveBeenNthCalledWith(3, scope, expect.any(Function), {
    isolationLevel: 'read committed',
  });
  expect(client.query).toHaveBeenCalledTimes(5);
  expect(client.query.mock.calls[0][0]).toContain('where tenant_id = $1');
  expect(client.query).toHaveBeenNthCalledWith(2, lockSql, lockParams);
  expect(client.query.mock.calls[2][0]).toContain('tenant_id = $');
  expect(client.query).toHaveBeenNthCalledWith(4, lockSql, lockParams);
  expect(client.query.mock.calls[4][0]).toContain('tenant_id = $2');
  await expect(deleteInventoryItem('item-1', 'other', scope)).rejects.toThrow(
    'Inventory scope mismatch'
  );
});

it('uses scoped client and preserves 501-row limit and tenant-shared ordering', async () => {
  const { listInventoryItemsByTenant } = await import('./inventoryRepository');
  const client = { query: vi.fn().mockResolvedValue({ rows: [] }) };
  scopedTransactionMock.mockImplementation(
    async (
      _scope: unknown,
      callback: (connection: typeof client) => Promise<unknown>
    ): Promise<unknown> => callback(client)
  );
  const scope = { tenantId: '00000000-0000-4000-8000-000000000001', userId: 'user-1' };
  await listInventoryItemsByTenant(scope.tenantId, 900, undefined, {}, scope);
  expect(scopedTransactionMock).toHaveBeenCalledWith(scope, expect.any(Function), {});
  expect(client.query).toHaveBeenCalledWith(expect.stringContaining('where tenant_id = $1'), [
    '00000000-0000-4000-8000-000000000001',
    501,
  ]);
  expect(client.query.mock.calls[0][0]).toContain('order by created_at desc limit $2');
  await expect(listInventoryItemsByTenant('other', 501, undefined, {}, scope)).rejects.toThrow(
    'scope mismatch'
  );
});

it('applies Chef Instructor timeouts and options on the scoped inventory client', async () => {
  const { listInventoryItemsByTenant } = await import('./inventoryRepository');
  const rows = [
    { id: 'shared', tenant_id: '00000000-0000-4000-8000-000000000001', user_id: 'user-2' },
  ];
  const client = { query: vi.fn().mockResolvedValue({ rows }) };
  scopedTransactionMock
    .mockReset()
    .mockImplementation(
      async (_scope: unknown, callback: (connection: typeof client) => Promise<unknown>) =>
        callback(client)
    );
  queryMock.mockReset();
  const scope = { tenantId: '00000000-0000-4000-8000-000000000001', userId: 'user-1' };
  const controller = new AbortController();
  const options = { signal: controller.signal, deadlineAt: Date.now() + 10_000 };

  await expect(
    listInventoryItemsByTenant('00000000-0000-4000-8000-000000000001', 500, 1_000, options, scope)
  ).resolves.toEqual(rows);
  expect(scopedTransactionMock).toHaveBeenCalledWith(scope, expect.any(Function), options);
  expect(queryMock).not.toHaveBeenCalled();
  expect(client.query.mock.calls).toEqual([
    ["select set_config('statement_timeout', $1, true)", ['1000ms']],
    ["select set_config('lock_timeout', $1, true)", ['1000ms']],
    [
      expect.stringContaining('where tenant_id = $1'),
      ['00000000-0000-4000-8000-000000000001', 500],
    ],
  ]);
  expect(client.query.mock.calls[2][0]).not.toMatch(/user_id\s*=/i);
});

it('persists all price columns atomically and preserves omitted fields', async () => {
  const { createInventoryItem, updateInventoryItem } = await import('./inventoryRepository');
  const client = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'item-1' }] }) };
  scopedTransactionMock
    .mockReset()
    .mockImplementation(
      async (_scope: unknown, callback: (connection: typeof client) => Promise<unknown>) =>
        callback(client)
    );
  const scope = { tenantId: '00000000-0000-4000-8000-000000000001', userId: 'user-1' };
  const priceReference = {
    amount: '4000',
    currency: 'COP',
    referenceQuantity: '1',
    referenceUnit: 'kg',
  } as const;
  await createInventoryItem({ ...scope, ingredientName: 'Arroz', priceReference });
  expect(client.query.mock.calls[1][0]).toContain(
    'price_currency, price_reference_quantity, price_reference_unit'
  );
  expect(client.query.mock.calls[1][1]).toEqual([
    '00000000-0000-4000-8000-000000000001',
    'user-1',
    'Arroz',
    null,
    null,
    null,
    null,
    '4000',
    null,
    null,
    null,
    null,
    'COP',
    '1',
    'kg',
  ]);
  await updateInventoryItem('item-1', scope.tenantId, { priceReference }, scope);
  expect(client.query.mock.calls[3][0]).toMatch(
    /estimated_unit_price = \$1, price_currency = \$2, price_reference_quantity = \$3, price_reference_unit = \$4, updated_at = now\(\) where id = \$5 and tenant_id = \$6/
  );
  expect(client.query.mock.calls[3][1]).toEqual([
    '4000',
    'COP',
    '1',
    'kg',
    'item-1',
    '00000000-0000-4000-8000-000000000001',
  ]);
  await updateInventoryItem('item-1', scope.tenantId, { ingredientName: 'Arroz' }, scope);
  expect(client.query.mock.calls[5][0]).not.toMatch(
    /estimated_unit_price|price_currency|price_reference/
  );
  await expect(updateInventoryItem('item-1', scope.tenantId, { priceReference })).rejects.toThrow(
    'authenticated inventory scope'
  );
  await expect(updateInventoryItem('item-1', 'other', { priceReference }, scope)).rejects.toThrow(
    'Inventory scope mismatch'
  );
  await expect(
    updateInventoryItem('item-1', scope.tenantId, { quantity: '500' }, scope)
  ).rejects.toThrow('audited inventory management');
  await expect(
    updateInventoryItem('item-1', scope.tenantId, { unit: 'kg' }, scope)
  ).rejects.toThrow('audited inventory management');
  await expect(
    updateInventoryItem('item-1', scope.tenantId, { lowStockThreshold: 1 }, scope)
  ).rejects.toThrow('audited inventory management');
  expect(client.query).toHaveBeenCalledTimes(6);
  for (const n of [1, 3, 5]) expect(client.query).toHaveBeenNthCalledWith(n, lockSql, lockParams);
});

it('rejects writes without authenticated scope before any database access', async () => {
  const { updateInventoryItem, deleteInventoryItem } = await import('./inventoryRepository');
  scopedTransactionMock.mockClear();
  queryMock.mockClear();
  const tenantId = '00000000-0000-4000-8000-000000000001';
  await expect(updateInventoryItem('item-1', tenantId, { notes: 'note' })).rejects.toThrow(
    'authenticated inventory scope'
  );
  await expect(deleteInventoryItem('item-1', tenantId)).rejects.toThrow(
    'authenticated inventory scope'
  );
  expect(scopedTransactionMock).not.toHaveBeenCalled();
  expect(queryMock).not.toHaveBeenCalled();
});

it.each([true, false])(
  'preserves audit history (%s) under the tenant and row locks',
  async (hasHistory) => {
    const { deleteInventoryItem } = await import('./inventoryRepository');
    const scope = { tenantId: '00000000-0000-4000-8000-000000000001', userId: 'user-1' };
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'item-1' }] })
        .mockResolvedValueOnce({ rows: hasHistory ? [{ id: 'movement-1' }] : [] })
        .mockResolvedValueOnce({ rows: [{ id: 'item-1' }] }),
    };
    scopedTransactionMock
      .mockReset()
      .mockImplementation(
        async (_scope: unknown, callback: (connection: typeof client) => Promise<unknown>) =>
          callback(client)
      );
    expect(await deleteInventoryItem('item-1', scope.tenantId, scope)).toBe(
      hasHistory ? 'has_history' : 'deleted'
    );
    expect(client.query).toHaveBeenNthCalledWith(1, lockSql, lockParams);
    expect(client.query).toHaveBeenNthCalledWith(2, expect.stringContaining('for update'), [
      'item-1',
      scope.tenantId,
    ]);
    expect(client.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('inventory_movements'),
      ['item-1', scope.tenantId]
    );
    if (hasHistory) expect(client.query).toHaveBeenCalledTimes(3);
    else
      expect(client.query).toHaveBeenNthCalledWith(4, expect.stringContaining('and not exists'), [
        'item-1',
        scope.tenantId,
      ]);
  }
);

it.each(['create', 'update', 'delete'] as const)(
  'fails closed when the %s lock cannot be acquired',
  async (operation) => {
    const { createInventoryItem, updateInventoryItem, deleteInventoryItem } =
      await import('./inventoryRepository');
    const client = { query: vi.fn().mockRejectedValue(new Error('lock failed')) };
    scopedTransactionMock
      .mockReset()
      .mockImplementation(
        async (_scope: unknown, callback: (connection: typeof client) => Promise<unknown>) =>
          callback(client)
      );
    const scope = { tenantId: '00000000-0000-4000-8000-000000000001', userId: 'user-1' };
    const actions = {
      create: () => createInventoryItem({ ...scope, ingredientName: 'Rice' }),
      update: () => updateInventoryItem('item-1', scope.tenantId, { notes: 'note' }, scope),
      delete: () => deleteInventoryItem('item-1', scope.tenantId, scope),
    };
    await expect(actions[operation]()).rejects.toThrow('lock failed');
    expect(client.query).toHaveBeenCalledExactlyOnceWith(lockSql, lockParams);
  }
);
