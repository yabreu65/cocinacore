import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ query: queryMock, mapSingleRow: vi.fn() }));

const { listTodayInventoryContextByTenant, listWastePreventionInventoryByTenant } =
  await import('./inventoryRepository');

describe('listTodayInventoryContextByTenant', () => {
  beforeEach(() => queryMock.mockReset());

  it('selects only context columns, tenant-scopes, filters by asOf and caps a parameterized limit', async () => {
    const rows = [{
      tenant_id: 'tenant-1', ingredient_name: 'tomato', quantity: '2', unit: 'each', expiration_date: '2025-04-12',
    }];
    queryMock.mockResolvedValue({ rows });
    const result = await listTodayInventoryContextByTenant('tenant-1', '2025-04-10', 500);
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/select\s+tenant_id,\s*ingredient_name,\s*quantity,\s*unit,\s*expiration_date/i);
    expect(result).toEqual(rows);
    expect(result[0].tenant_id).toBe('tenant-1');
    expect(sql).toContain('tenant_id = $1');
    expect(sql).toMatch(/expiration_date\s+is null\s+or\s+expiration_date\s*>=\s*\$2/i);
    expect(sql).toMatch(/order by expiration_date asc nulls last/i);
    expect(sql).toMatch(/limit \$3/i);
    expect(sql).not.toMatch(/select\s+\*/i);
    expect(params).toEqual(['tenant-1', '2025-04-10', 50]);
  });

  it('bounds small and invalid limits to a positive maximum-safe value', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await listTodayInventoryContextByTenant('tenant-1', '2025-04-10', 0);
    expect((queryMock.mock.calls[0] as [string, unknown[]])[1][2]).toBe(1);
  });
});

describe('listWastePreventionInventoryByTenant', () => {
  beforeEach(() => queryMock.mockReset());

  it('reads bounded tenant inventory without filtering away unknown or expired lots', async () => {
    const rows = [{
      id: 'lot-1', tenant_id: 'tenant-1', user_id: 'user-1', ingredient_name: 'Tomate',
      quantity: '2', unit: 'unidad', category: 'Verduras', expiration_date: '2026-10-28',
      estimated_unit_price: null, purchase_location: null, low_stock_threshold: null,
      normalized_name: 'tomate', notes: null, created_at: '2026-10-20T00:00:00.000Z',
      updated_at: '2026-10-20T00:00:00.000Z',
    }];
    queryMock.mockResolvedValue({ rows });

    const result = await listWastePreventionInventoryByTenant('tenant-1', 500);

    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(result).toEqual(rows);
    expect(sql).toContain('tenant_id = $1');
    expect(sql).toMatch(/order by expiration_date asc nulls last, created_at asc, id asc/i);
    expect(sql).toMatch(/limit \$2/i);
    expect(params).toEqual(['tenant-1', 101]);
  });

  it('keeps the read limit positive and bounded', async () => {
    queryMock.mockResolvedValue({ rows: [] });

    await listWastePreventionInventoryByTenant('tenant-1', 0);

    expect((queryMock.mock.calls[0] as [string, unknown[]])[1][1]).toBe(2);
  });
});
