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
  const { createInventoryItem, INVENTORY_ROW_REVISION } = await import('./inventoryRepository');
  const row = { id: 'item-1', revision: '123:1794520000.123456' };
  const client = {
    query: vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [row] }),
  };
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
  await expect(createInventoryItem(input)).resolves.toEqual(row);
  expect(scopedTransactionMock).toHaveBeenCalledWith(
    { tenantId: input.tenantId, userId: input.userId },
    expect.any(Function)
  );
  expect(client.query).toHaveBeenNthCalledWith(1, lockSql, lockParams);
  expect(client.query.mock.calls[1][0]).toContain(
    `returning *, ${INVENTORY_ROW_REVISION} as revision`
  );
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
    const client = { query: vi.fn().mockResolvedValue({ rows }) };
    scopedTransactionMock
      .mockReset()
      .mockImplementation(
        async (_scope: unknown, callback: (connection: typeof client) => Promise<unknown>) =>
          callback(client)
      );
    const scope = { tenantId: '00000000-0000-4000-8000-000000000001', userId: 'user-1' };
    const result = await listTodayInventoryContextByTenant(
      '00000000-0000-4000-8000-000000000001',
      '2025-04-10',
      500,
      scope
    );
    const [sql, params] = client.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(
      /select\s+tenant_id,\s*ingredient_name,\s*quantity,\s*unit,\s*expiration_date/i
    );
    expect(result).toEqual(rows);
    expect(result[0].tenant_id).toBe('00000000-0000-4000-8000-000000000001');
    expect(sql).toContain('tenant_id = $1');
    expect(sql).toContain('(expiration_date at time zone $4)::date end) >= $2::date');
    expect(sql).toMatch(/order by expiration_date asc nulls last/i);
    expect(sql).toMatch(/limit \$3/i);
    expect(sql).not.toMatch(/select\s+\*/i);
    expect(params).toEqual(['00000000-0000-4000-8000-000000000001', '2025-04-10', 50, 'UTC']);
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
    expect(sql).toContain('tenant_id = $1 and (expiration_date is null or');
    expect(sql).toContain('(expiration_date at time zone $4)::date end) >= $2::date');
    expect(sql).toMatch(/order by expiration_date asc nulls last/i);
    expect(sql).toMatch(/limit \$3/i);
    expect(sql).not.toMatch(/user_id\s*=/i);
    expect(params).toEqual(['00000000-0000-4000-8000-000000000001', '2025-04-10', 50, 'UTC']);
    await expect(
      listTodayInventoryContextByTenant('other', '2025-04-10', 50, scope)
    ).rejects.toThrow('Inventory scope mismatch');
    expect(scopedTransactionMock).toHaveBeenCalledOnce();
    expect(client.query).toHaveBeenCalledOnce();
  });

  it('bounds small and invalid limits to a positive maximum-safe value', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    scopedTransactionMock
      .mockReset()
      .mockImplementation(
        async (_scope: unknown, callback: (connection: typeof client) => Promise<unknown>) =>
          callback(client)
      );
    const scope = { tenantId: '00000000-0000-4000-8000-000000000001', userId: 'user-1' };
    await listTodayInventoryContextByTenant(
      '00000000-0000-4000-8000-000000000001',
      '2025-04-10',
      0,
      scope
    );
    expect((client.query.mock.calls[0] as [string, unknown[]])[1][2]).toBe(1);
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
    const client = { query: vi.fn().mockResolvedValue({ rows }) };
    scopedTransactionMock
      .mockReset()
      .mockImplementation(
        async (_scope: unknown, callback: (connection: typeof client) => Promise<unknown>) =>
          callback(client)
      );
    const scope = { tenantId: '00000000-0000-4000-8000-000000000001', userId: 'user-1' };

    const result = await listWastePreventionInventoryByTenant(
      '00000000-0000-4000-8000-000000000001',
      500,
      scope
    );

    const [sql, params] = client.query.mock.calls[0] as [string, unknown[]];
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
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    scopedTransactionMock
      .mockReset()
      .mockImplementation(
        async (_scope: unknown, callback: (connection: typeof client) => Promise<unknown>) =>
          callback(client)
      );
    const scope = { tenantId: '00000000-0000-4000-8000-000000000001', userId: 'user-1' };

    await listWastePreventionInventoryByTenant('00000000-0000-4000-8000-000000000001', 0, scope);

    expect((client.query.mock.calls[0] as [string, unknown[]])[1][1]).toBe(2);
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
  const { createInventoryItem, updateInventoryItem, INVENTORY_ROW_REVISION } =
    await import('./inventoryRepository');
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
    `returning *, ${INVENTORY_ROW_REVISION} as revision`
  );
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
  await expect(updateInventoryItem('item-1', scope.tenantId, { priceReference }, scope))
    .rejects.toThrow('audited inventory management');
  await updateInventoryItem('item-1', scope.tenantId, { ingredientName: 'Arroz' }, scope);
  expect(client.query.mock.calls[3][0]).not.toMatch(
    /estimated_unit_price|price_currency|price_reference/
  );
  await expect(
    updateInventoryItem('item-1', scope.tenantId, { priceReference }, undefined as never)
  ).rejects.toThrow('authenticated inventory scope');
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
  expect(client.query).toHaveBeenCalledTimes(4);
  for (const n of [1, 3]) expect(client.query).toHaveBeenNthCalledWith(n, lockSql, lockParams);
});

it('rejects writes without authenticated scope before any database access', async () => {
  const { updateInventoryItem, deleteInventoryItem } = await import('./inventoryRepository');
  scopedTransactionMock.mockClear();
  queryMock.mockClear();
  const tenantId = '00000000-0000-4000-8000-000000000001';
  await expect(
    updateInventoryItem('item-1', tenantId, { notes: 'note' }, undefined as never)
  ).rejects.toThrow('authenticated inventory scope');
  await expect(deleteInventoryItem('item-1', tenantId, undefined as never)).rejects.toThrow(
    'authenticated inventory scope'
  );
  expect(scopedTransactionMock).not.toHaveBeenCalled();
  expect(queryMock).not.toHaveBeenCalled();
});

it.each([true, false])(
  'preserves audit history (%s) using the non-cascading FK under tenant and row locks',
  async (hasHistory) => {
    const { deleteInventoryItem } = await import('./inventoryRepository');
    const scope = { tenantId: '00000000-0000-4000-8000-000000000001', userId: 'user-1' };
    const client = {
      query: vi.fn().mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'item-1', history_protected: true }] }),
    };
    if (hasHistory) client.query.mockRejectedValueOnce(Object.assign(new Error('FK violation'), { code: '23503' }));
    else client.query.mockResolvedValueOnce({ rows: [{ id: 'item-1' }] });
    scopedTransactionMock.mockReset().mockImplementation(
      async (_scope: unknown, callback: (connection: typeof client) => Promise<unknown>) => callback(client)
    );
    expect(await deleteInventoryItem('item-1', scope.tenantId, scope)).toBe(hasHistory ? 'has_history' : 'deleted');
    expect(client.query).toHaveBeenNthCalledWith(1, lockSql, lockParams);
    expect(client.query).toHaveBeenNthCalledWith(2, expect.stringContaining('for update'), ['item-1', scope.tenantId]);
    expect(client.query).toHaveBeenNthCalledWith(3, expect.stringContaining('delete from public.recipe_inventory_items'), ['item-1', scope.tenantId]);
    expect(client.query).toHaveBeenCalledTimes(3);
  }
);

it('fails closed when the scoped movement history is unavailable', async () => {
  const { deleteInventoryItem } = await import('./inventoryRepository');
  const scope = { tenantId: '00000000-0000-4000-8000-000000000001', userId: 'user-1' };
  const client = { query: vi.fn().mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 'item-1', history_protected: false }] }) };
  scopedTransactionMock.mockImplementation(async (_scope: unknown, callback: (connection: typeof client) => Promise<unknown>) => callback(client));
  expect(await deleteInventoryItem('item-1', scope.tenantId, scope)).toBe('history_unavailable');
  expect(client.query).toHaveBeenCalledTimes(2);
  expect(client.query).toHaveBeenNthCalledWith(2, expect.stringContaining('c.confdeltype'), ['item-1', scope.tenantId]);
});

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

it('reads a single item with its exact revision through authenticated scope', async () => {
  const { findInventoryItemById, updateInventoryItem, INVENTORY_ROW_REVISION } =
    await import('./inventoryRepository');
  const scope = { tenantId: '00000000-0000-4000-8000-000000000001', userId: 'user-1' };
  const row = { id: 'item-1', revision: '123:1794520000.123456' };
  const client = {
    query: vi
      .fn()
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [row] }),
  };
  scopedTransactionMock
    .mockReset()
    .mockImplementation(
      async (_scope: unknown, callback: (connection: typeof client) => Promise<unknown>) =>
        callback(client)
    );
  queryMock.mockClear();
  expect(await findInventoryItemById('item-1', scope.tenantId, scope)).toEqual(row);
  expect(await findInventoryItemById('missing', scope.tenantId, scope)).toBeNull();
  expect(await updateInventoryItem('item-1', scope.tenantId, {}, scope)).toEqual(row);
  expect(client.query).toHaveBeenNthCalledWith(
    1,
    expect.stringContaining(`select *, ${INVENTORY_ROW_REVISION} as revision`),
    ['item-1', scope.tenantId]
  );
  expect(client.query).toHaveBeenNthCalledWith(
    3,
    expect.stringContaining(`select *, ${INVENTORY_ROW_REVISION} as revision`),
    ['item-1', scope.tenantId]
  );
  expect(scopedTransactionMock).toHaveBeenCalledTimes(3);
  expect(queryMock).not.toHaveBeenCalled();
});

it.each(['find', 'list', 'today', 'waste'] as const)(
  'rejects missing or mismatched scope for %s before database access',
  async (operation) => {
    const {
      findInventoryItemById,
      listInventoryItemsByTenant,
      listTodayInventoryContextByTenant,
      listWastePreventionInventoryByTenant,
    } = await import('./inventoryRepository');
    const tenantId = '00000000-0000-4000-8000-000000000001';
    const foreign = { tenantId: '00000000-0000-4000-8000-000000000002', userId: 'user-2' };
    scopedTransactionMock.mockClear();
    queryMock.mockClear();
    for (const scope of [undefined as never, foreign]) {
      const actions = {
        find: () => findInventoryItemById('item-1', tenantId, scope),
        list: () => listInventoryItemsByTenant(tenantId, 501, undefined, {}, scope),
        today: () => listTodayInventoryContextByTenant(tenantId, '2026-11-14', 50, scope),
        waste: () => listWastePreventionInventoryByTenant(tenantId, 100, scope),
      };
      await expect(actions[operation]()).rejects.toThrow(
        scope ? 'Inventory scope mismatch' : 'authenticated inventory scope'
      );
    }
    expect(scopedTransactionMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  }
);
