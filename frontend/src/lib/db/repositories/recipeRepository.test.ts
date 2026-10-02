import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const mapSingleRowMock = vi.fn();

vi.mock('@/lib/db', () => ({
  query: queryMock,
  mapSingleRow: mapSingleRowMock,
}));

const { toggleRecipeSaved } = await import('./recipeRepository');

const ownedRow = {
  id: 'recipe-1',
  tenant_id: 'tenant-1',
  user_id: 'user-1',
  is_saved: true,
};

describe('toggleRecipeSaved', () => {
  beforeEach(() => {
    queryMock.mockReset();
    mapSingleRowMock.mockReset();
    mapSingleRowMock.mockImplementation((result: { rows: unknown[] }) => result.rows[0] ?? null);
  });

  it('updates only the owned row with id, tenant, and user parameters in order', async () => {
    queryMock.mockResolvedValue({ rows: [ownedRow] });

    const result = await toggleRecipeSaved('recipe-1', 'tenant-1', 'user-1', true);

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('set is_saved = $1');
    expect(sql).toContain('id = $2');
    expect(sql).toContain('tenant_id = $3');
    expect(sql).toContain('user_id = $4');
    expect(params).toEqual([true, 'recipe-1', 'tenant-1', 'user-1']);
    expect(result).toEqual(ownedRow);
  });

  it('returns null when no row matches the scoped update', async () => {
    queryMock.mockResolvedValue({ rows: [] });

    const result = await toggleRecipeSaved('missing-recipe', 'tenant-1', 'user-1', false);

    expect(result).toBeNull();
  });
});
