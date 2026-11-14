import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InventoryManagementRequest } from '@/lib/inventory/inventory-management';
const scopedTransactionMock = vi.fn();
const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ scopedTransaction: scopedTransactionMock, query: queryMock }));
const { manageInventoryItem } = await import('./inventoryManagementRepository');
const scope = { tenantId: '00000000-0000-4000-8000-000000000001', userId: 'actor-1' };
const id = '01234567-89ab-4cde-8fab-0123456789ab';
const revision = '123:1794520000.123456';
const row = {
  id,
  tenant_id: scope.tenantId,
  user_id: 'original-owner',
  ingredient_name: 'Harina',
  normalized_name: 'harina',
  quantity: '500',
  unit: 'g',
  low_stock_threshold: '250.0000',
  revision,
  estimated_unit_price: '4000',
  price_currency: 'COP',
  price_reference_quantity: '1',
  price_reference_unit: 'kg',
};
const client = { query: vi.fn() };
const count: InventoryManagementRequest = {
  id,
  revision,
  action: 'stock',
  command: { kind: 'count', quantity: '300', reason: 'Conteo físico' },
};
beforeEach(() => {
  vi.clearAllMocks();
  client.query.mockReset();
  scopedTransactionMock.mockImplementation(
    async (_scope: unknown, fn: (connection: typeof client) => Promise<unknown>) => fn(client)
  );
  client.query
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [row] })
    .mockResolvedValueOnce({
      rows: [{ ...row, quantity: '300', revision: '124:1794520001.000001' }],
    })
    .mockResolvedValueOnce({ rows: [] });
});
describe('audited inventory management', () => {
  it('locks the tenant row, updates stock and records the signed movement on the same scoped client', async () => {
    const result = await manageInventoryItem(scope, count);
    expect(result).toMatchObject({
      status: 'updated',
      item: { quantity: '300', user_id: 'original-owner', price_currency: 'COP' },
    });
    expect(scopedTransactionMock).toHaveBeenCalledExactlyOnceWith(scope, expect.any(Function));
    expect(client.query).toHaveBeenNthCalledWith(
      1,
      'select pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`cocinacore:inventory-source:v1:${scope.tenantId}`]
    );
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/where id=\$1 and tenant_id=\$2 for update/),
      [id, scope.tenantId]
    );
    expect(client.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('set quantity=$1,unit=$2,low_stock_threshold=$3'),
      ['300', 'g', '250', id, scope.tenantId]
    );
    expect(client.query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('insert into public.inventory_movements'),
      [
        scope.tenantId,
        scope.userId,
        id,
        'manual_adjustment',
        '-200',
        'g',
        'harina',
        'manual_inventory_count',
        expect.stringContaining('signed_delta'),
      ]
    );
    expect(queryMock).not.toHaveBeenCalled();
  });
  it('audits a confirmed legacy baseline without inventing a physical delta', async () => {
    client.query
      .mockReset()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ ...row, quantity: '1', unit: '500 gramos', low_stock_threshold: null }],
      })
      .mockResolvedValueOnce({ rows: [{ ...row, quantity: '500', unit: 'g' }] })
      .mockResolvedValueOnce({ rows: [] });
    expect(
      await manageInventoryItem(scope, {
        ...count,
        command: {
          kind: 'correct',
          quantity: '500',
          unit: 'g',
          lowStockThreshold: null,
          reason: 'Pesado',
        },
      })
    ).toMatchObject({ status: 'updated' });
    expect(client.query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('insert into public.inventory_movements'),
      [
        scope.tenantId,
        scope.userId,
        id,
        'correction',
        '500',
        'g',
        'harina',
        'manual_inventory_baseline_correction',
        expect.stringContaining('new_confirmed_baseline_not_delta'),
      ]
    );
  });
  it('rejects stale revisions before writes', async () => {
    expect(
      await manageInventoryItem(scope, { ...count, revision: '122:1794520000.123456' })
    ).toEqual({ status: 'conflict' });
    expect(client.query).toHaveBeenCalledTimes(2);
  });
  it('does not reveal or mutate an inaccessible row', async () => {
    client.query.mockReset().mockResolvedValue({ rows: [] });
    expect(await manageInventoryItem(scope, count)).toEqual({ status: 'not_found' });
    expect(client.query).toHaveBeenCalledTimes(2);
  });
  it('does not write when the planner rejects an incompatible conversion', async () => {
    expect(
      await manageInventoryItem(scope, { ...count, command: { kind: 'convert', unit: 'ml' } })
    ).toMatchObject({ status: 'invalid' });
    expect(client.query).toHaveBeenCalledTimes(2);
  });
  it.each([
    { kind: 'convert', unit: 'kg' },
    { kind: 'count', quantity: '500', reason: 'Conteo' },
  ] as const)('writes no physical movement for %j', async (command) => {
    expect(await manageInventoryItem(scope, { ...count, command })).toMatchObject({
      status: 'updated',
    });
    expect(client.query).toHaveBeenCalledTimes(3);
  });
  it('propagates movement failure to the transaction wrapper, never returning success or falling back to an unscoped query', async () => {
    client.query
      .mockReset()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [row] })
      .mockRejectedValueOnce(new Error('movement failed'));
    await expect(manageInventoryItem(scope, count)).rejects.toThrow('movement failed');
    expect(scopedTransactionMock).toHaveBeenCalledTimes(1);
    expect(queryMock).not.toHaveBeenCalled();
  });
  it('edits only explicit metadata and never overwrites stock or price', async () => {
    expect(
      await manageInventoryItem(scope, {
        id,
        revision,
        action: 'metadata',
        changes: { ingredientName: 'Harina integral', lowStockThreshold: '100' },
      })
    ).toMatchObject({ status: 'updated' });
    expect(client.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining(
        'ingredient_name=$1,normalized_name=$2,low_stock_threshold=$3,updated_at=now()'
      ),
      ['Harina integral', 'harina integral', 100, id, scope.tenantId]
    );
    expect(client.query).toHaveBeenCalledTimes(3);
  });
  it('rejects a minimum for an unknown unit but permits explicitly clearing an invalid minimum', async () => {
    client.query
      .mockReset()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...row, unit: '500 gramos' }] });
    expect(
      await manageInventoryItem(scope, {
        id,
        revision,
        action: 'metadata',
        changes: { lowStockThreshold: '100' },
      })
    ).toMatchObject({ status: 'invalid' });
    expect(client.query).toHaveBeenCalledTimes(2);
    client.query
      .mockReset()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...row, unit: '500 gramos' }] })
      .mockResolvedValueOnce({ rows: [row] });
    expect(
      await manageInventoryItem(scope, {
        id,
        revision,
        action: 'metadata',
        changes: { lowStockThreshold: null },
      })
    ).toMatchObject({ status: 'updated' });
  });
  it('rejects lock failure before reading stock or recording any movement', async () => {
    client.query.mockReset().mockRejectedValueOnce(new Error('lock failed'));
    await expect(manageInventoryItem(scope, count)).rejects.toThrow('lock failed');
    expect(client.query).toHaveBeenCalledExactlyOnceWith(
      'select pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`cocinacore:inventory-source:v1:${scope.tenantId}`]
    );
    expect(queryMock).not.toHaveBeenCalled();
  });
});
