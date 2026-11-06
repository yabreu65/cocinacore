import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCookingSession: vi.fn(),
  findPersistentRecipeVersion: vi.fn(),
  findCulinaryProfileByUserAndTenant: vi.fn(),
  listInventoryItemsByTenant: vi.fn(),
  findCulinaryProfileTermsByUserId: vi.fn(),
}));

vi.mock('@/lib/db/repositories/cookingSessionRepository', () => ({
  getCookingSession: mocks.getCookingSession,
}));
vi.mock('@/lib/db/repositories/recipeRepository', () => ({
  findPersistentRecipeVersion: mocks.findPersistentRecipeVersion,
}));
vi.mock('@/lib/db/repositories/culinaryProfileRepository', () => ({
  findCulinaryProfileByUserAndTenant: mocks.findCulinaryProfileByUserAndTenant,
  findCulinaryProfileTermsByUserId: mocks.findCulinaryProfileTermsByUserId,
}));
vi.mock('@/lib/db/repositories/inventoryRepository', () => ({
  listInventoryItemsByTenant: mocks.listInventoryItemsByTenant,
}));

const { loadCookingTeacherContext } = await import('./cooking-teacher-context');

function observeAbort(signal: AbortSignal | undefined, onAbort: () => void): void {
  if (!signal) throw new Error('Expected a linked cancellation signal.');
  if (signal.aborted) onAbort();
  else signal.addEventListener('abort', onAbort, { once: true });
}

describe('loadCookingTeacherContext cancellation', () => {
  it('aborts sibling context queries and waits for them after one query fails', async () => {
    const session = {
      id: 'session-1',
      tenant_id: 'tenant-1',
      user_id: 'user-1',
      status: 'active',
      current_step: 1,
      total_steps: 1,
      meal_type: 'lunch',
      day_index: 1,
      recipe_id: 'recipe-1',
      recipe_version_id: 'version-1',
      instruction_snapshot: {},
    };
    mocks.getCookingSession.mockResolvedValue(session);
    const aborted = new Set<string>();
    const delayed = () =>
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), 5);
      });
    mocks.findPersistentRecipeVersion.mockImplementation(
      (
        _recipeId: string,
        _versionId: string,
        _scope: unknown,
        _timeout: number,
        options: { signal?: AbortSignal }
      ) => {
        observeAbort(options.signal, () => aborted.add('recipe'));
        return delayed();
      }
    );
    mocks.listInventoryItemsByTenant.mockImplementation(
      (_tenantId: string, _limit: number, _timeout: number, options: { signal?: AbortSignal }) => {
        observeAbort(options.signal, () => aborted.add('inventory'));
        return delayed();
      }
    );
    mocks.findCulinaryProfileTermsByUserId.mockImplementation(
      (_userId: string, _tenantId: string, _timeout: number, options: { signal?: AbortSignal }) => {
        observeAbort(options.signal, () => aborted.add('terms'));
        return delayed();
      }
    );
    const failure = new Error('profile query failed');
    mocks.findCulinaryProfileByUserAndTenant.mockRejectedValue(failure);

    const deadlineAt = Date.now() + 1_000;
    await expect(
      loadCookingTeacherContext('session-1', 'tenant-1', 'user-1', { deadlineAt })
    ).rejects.toBe(failure);

    expect(mocks.getCookingSession).toHaveBeenCalledWith(
      'session-1',
      'tenant-1',
      'user-1',
      expect.any(Number),
      { deadlineAt }
    );
    expect(mocks.listInventoryItemsByTenant).toHaveBeenCalledWith(
      'tenant-1',
      500,
      expect.any(Number),
      { signal: expect.any(AbortSignal) as unknown as AbortSignal, deadlineAt },
      { tenantId: 'tenant-1', userId: 'user-1' }
    );
    const timeout = mocks.listInventoryItemsByTenant.mock.calls.at(-1)?.[2] as number;
    expect(timeout).toBeGreaterThan(0);
    expect(timeout).toBeLessThanOrEqual(1_000);

    expect(aborted).toEqual(new Set(['recipe', 'inventory', 'terms']));
  });
});
