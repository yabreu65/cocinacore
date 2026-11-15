import { describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ scoped: vi.fn(), query: vi.fn() }));
vi.mock('@/lib/db', () => ({ scopedTransaction: mocks.scoped, query: mocks.query }));
import { findReconciliationReceipt } from './realConsumptionRepository';
describe('scoped reconciliation receipt recovery', () => {
  it.each([
    { rows: [{ id: 'op-1', movement_count: '2' }] },
    { rows: [{ id: 'op-1', movement_count: '0' }] },
    { rows: [] },
  ])('reads confirmed receipt and movement count without writes (%j)', async ({ rows }) => {
    const client = { query: vi.fn().mockResolvedValue({ rows }) };
    mocks.scoped
      .mockReset()
      .mockImplementation(
        async (_scope: unknown, callback: (connection: typeof client) => Promise<unknown>) =>
          callback(client)
      );
    const result = await findReconciliationReceipt('session', 'tenant', 'user');
    expect(result).toEqual(
      rows.length ? { operationId: 'op-1', movementCount: Number(rows[0].movement_count) } : null
    );
    expect(mocks.scoped).toHaveBeenCalledWith(
      { tenantId: 'tenant', userId: 'user' },
      expect.any(Function)
    );
    expect(client.query).toHaveBeenCalledOnce();
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining(
        "o.cooking_session_id=$1 and o.tenant_id=$2 and o.user_id=$3 and o.status='confirmed'"
      ),
      ['session', 'tenant', 'user']
    );
    expect(client.query.mock.calls[0][0]).not.toMatch(
      /insert into|update public|delete from|for update/i
    );
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
