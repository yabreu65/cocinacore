import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ scoped: vi.fn(), query: vi.fn(), transaction: vi.fn() }));
vi.mock('@/lib/db', () => ({
  scopedTransaction: mocks.scoped,
  query: mocks.query,
  transaction: mocks.transaction,
}));
const { consumePlannedMeal, getMealPlanConsumptions } =
  await import('./mealPlanConsumptionRepository');

describe('scoped meal consumption', () => {
  it('uses one scoped client for consumption reads', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ consumption_payload: {} }] }) };
    mocks.scoped
      .mockReset()
      .mockImplementation(
        async (_scope: unknown, callback: (connection: typeof client) => Promise<unknown>) =>
          callback(client)
      );
    await expect(
      getMealPlanConsumptions('plan-1', 'user-1', '22222222-2222-4222-8222-222222222222')
    ).resolves.toEqual({});
    expect(mocks.scoped).toHaveBeenCalledWith(
      { tenantId: '22222222-2222-4222-8222-222222222222', userId: 'user-1' },
      expect.any(Function)
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('tenant_id=$2 and user_id=$3'),
      ['plan-1', '22222222-2222-4222-8222-222222222222', 'user-1']
    );
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('propagates a missing plan from the same scoped transaction', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    mocks.scoped
      .mockReset()
      .mockImplementation(
        async (_scope: unknown, callback: (connection: typeof client) => Promise<unknown>) =>
          callback(client)
      );
    await expect(
      consumePlannedMeal({
        mealPlanId: 'plan-1',
        tenantId: '22222222-2222-4222-8222-222222222222',
        userId: 'user-1',
        dayIndex: 1,
        mealType: 'lunch',
      })
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(mocks.scoped).toHaveBeenCalledWith(
      { tenantId: '22222222-2222-4222-8222-222222222222', userId: 'user-1' },
      expect.any(Function),
      { isolationLevel: 'read committed' }
    );
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
