import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreatePersistentRecipeSchema } from '@/lib/validation';

const { transactionMock } = vi.hoisted(() => ({ transactionMock: vi.fn() }));
const queryMock = vi.fn();
const mapSingleRowMock = vi.fn();

vi.mock('@/lib/db', () => ({
  query: queryMock,
  mapSingleRow: mapSingleRowMock,
  transaction: transactionMock,
}));

const {
  toggleRecipeSaved,
  listTodayRecipeHistoryByUserAndTenant,
  createPersistentRecipe,
  appendPersistentRecipeVersion,
  listPersistentRecipes,
  findDuplicatePersistentRecipeTitles,
  setPersistentRecipeArchived,
  restorePersistentRecipeVersion,
} = await import('./recipeRepository');

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

describe('listTodayRecipeHistoryByUserAndTenant', () => {
  beforeEach(() => queryMock.mockReset());

  it('selects only history context columns with tenant, user, cutoff and parameterized capped limit', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await listTodayRecipeHistoryByUserAndTenant('user-1', 'tenant-1', '2025-04-01T00:00:00Z', 90);
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/select\s+source,\s*recipe_title,\s*recipe_payload,\s*created_at/i);
    expect(sql).toContain('user_id = $1');
    expect(sql).toContain('tenant_id = $2');
    expect(sql).toContain('created_at >= $3');
    expect(sql).toMatch(/limit \$4/i);
    expect(sql).not.toMatch(/select\s+\*/i);
    expect(params).toEqual(['user-1', 'tenant-1', '2025-04-01T00:00:00Z', 20]);
  });

  it('bounds a zero limit to a positive value', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await listTodayRecipeHistoryByUserAndTenant('user-1', 'tenant-1', '2025-04-01T00:00:00Z', 0);
    expect((queryMock.mock.calls[0] as [string, unknown[]])[1][3]).toBe(1);
  });
});

const recipeScope = { tenantId: 'tenant-1', userId: 'user-1' };
const recipeContent = {
  title: 'Tomato soup',
  instructions: 'Simmer the tomatoes.',
  servings: 2,
  ingredients: [{ name: 'Tomato', quantity: '2', unit: 'cups', structured: true }],
};

function mockTransaction(clientQuery: ReturnType<typeof vi.fn>) {
  transactionMock.mockImplementation(async (...args: unknown[]) => {
    const callback = args.find((argument) => typeof argument === 'function');
    if (typeof callback !== 'function') throw new Error('Transaction callback was not supplied');
    return (callback as (client: { query: typeof clientQuery }) => unknown)({ query: clientQuery });
  });
}

describe('persistent recipe repository', () => {
  beforeEach(() => {
    transactionMock.mockReset();
  });

  it('validates manual ingredients, preserves structured properties, and rejects request ownership fields', () => {
    const valid = CreatePersistentRecipeSchema.safeParse({
      title: ' Tomato soup ',
      instructions: 'Simmer.',
      ingredients: [{ name: 'Tomato', quantity: '2', unit: 'cups' }],
    });
    expect(valid.success).toBe(true);
    if (valid.success) expect(valid.data.ingredients[0]).toMatchObject({ name: 'Tomato', quantity: '2', unit: 'cups' });
    expect(CreatePersistentRecipeSchema.safeParse({
      title: 'Recipe', instructions: 'Cook.', ingredients: [{ name: 'Tomato', unexpected: true }],
    }).success).toBe(false);
    expect(CreatePersistentRecipeSchema.safeParse({
      title: 'Recipe', instructions: 'Cook.', ingredients: [{ name: ' ' }],
    }).success).toBe(false);
    expect(CreatePersistentRecipeSchema.safeParse({
      title: 'Recipe', instructions: 'Cook.', ingredients: [{ name: 'Tomato' }], userId: 'user-1',
    }).success).toBe(false);
  });

  it('creates the parent and immutable version one in one scoped transaction', async () => {
    const recipe = {
      id: 'recipe-1', tenant_id: 'tenant-1', user_id: 'user-1', category: null, tags: [],
      archived_at: null, created_at: 'now', updated_at: 'now',
    };
    const version = { id: 'version-1', recipe_id: 'recipe-1', version_number: 1, ...recipeContent };
    const clientQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [recipe] })
      .mockResolvedValueOnce({ rows: [version] });
    mockTransaction(clientQuery);

    const result = await createPersistentRecipe(recipeScope, recipeContent);

    expect(transactionMock).toHaveBeenCalledOnce();
    const sqlCalls = (clientQuery.mock.calls as unknown[][]).map((call) => String(call[0]));
    expect(sqlCalls).toEqual([
      expect.stringContaining("set_config('app.tenant_id'"),
      expect.stringContaining('insert into public.user_recipes'),
      expect.stringContaining('insert into public.user_recipe_versions'),
    ]);
    expect(clientQuery.mock.calls[0]?.[1]).toEqual(['tenant-1', 'user-1']);
    expect(clientQuery.mock.calls[1]?.[1]).toEqual(['tenant-1', 'user-1', null, []]);
    expect(result.current_version).toEqual(version);
  });

  it('locks the scoped parent before calculating and appending a new version', async () => {
    const clientQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'recipe-1', category: null, tags: [] }] })
      .mockResolvedValueOnce({ rows: [{ next_version: 4 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'version-4', version_number: 4 }] })
      .mockResolvedValueOnce({ rows: [] });
    mockTransaction(clientQuery);

    await appendPersistentRecipeVersion('recipe-1', recipeScope, recipeContent);

    const sql = clientQuery.mock.calls.map(([statement]) => String(statement));
    expect(sql[1]).toMatch(/tenant_id = \$2 and user_id = \$3[\s\S]*for update/i);
    expect(sql[2]).toContain('coalesce(max(version_number), 0) + 1');
    expect(clientQuery.mock.calls[1]?.[1]).toEqual(['recipe-1', 'tenant-1', 'user-1']);
    expect(sql.some((statement) => /update\s+public\.user_recipe_versions|delete\s+from\s+public\.user_recipe/i.test(statement))).toBe(false);
  });

  it('returns the saved-history link in the internal recipe list projection', async () => {
    const clientQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        id: 'recipe-1', tenant_id: 'tenant-1', user_id: 'user-1', category: null, tags: [],
        archived_at: null, created_at: '', updated_at: '', current_version_id: 'version-1',
        current_version_number: 1, current_version_title: 'Rice', current_version_instructions: 'Cook.',
        current_version_servings: 2, current_version_ingredients: [{ name: 'rice', quantity: '1', unit: 'cup' }],
        current_version_source_recipe_history_id: 'history-1', current_version_created_at: '',
      }] });
    mockTransaction(clientQuery);

    const recipes = await listPersistentRecipes(recipeScope);

    expect(String(clientQuery.mock.calls[1]?.[0])).toContain(
      'current_version.source_recipe_history_id as current_version_source_recipe_history_id'
    );
    expect(recipes[0]?.current_version.source_recipe_history_id).toBe('history-1');
  });

  it('scopes list search and archive filtering with parameterized pagination', async () => {
    const clientQuery = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    mockTransaction(clientQuery);
    await listPersistentRecipes(recipeScope, { search: 'soup', archived: 'active', limit: 10, offset: 5 });

    const [contextSql, listSql] = clientQuery.mock.calls.map(([statement]) => String(statement));
    expect(contextSql).toContain("set_config('app.tenant_id'");
    expect(listSql).toContain('recipe.tenant_id = $1');
    expect(listSql).toContain('recipe.user_id = $2');
    expect(listSql).toContain('recipe.archived_at is null');
    expect(listSql).toContain('current_version.title ilike $3');
    expect(listSql).toContain('limit $4 offset $5');
    expect(clientQuery.mock.calls[1]?.[1]).toEqual(['tenant-1', 'user-1', '%soup%', 10, 5]);
  });

  it('returns duplicate-title candidates as advisory warnings without writes', async () => {
    const clientQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ recipe_id: 'existing', title: 'Tomato Soup', version_number: 2 }] });
    mockTransaction(clientQuery);

    const candidates = await findDuplicatePersistentRecipeTitles(recipeScope, 'tomato soup');

    expect(candidates).toEqual([{ recipeId: 'existing', title: 'Tomato Soup', versionNumber: 2 }]);
    const sql = String(clientQuery.mock.calls[1]?.[0]);
    expect(sql).toContain('recipe.tenant_id = $1 and recipe.user_id = $2');
    expect(sql).toContain('regexp_replace');
    expect(sql).not.toMatch(/\b(insert|update|delete)\b/i);
    expect(clientQuery.mock.calls[1]?.[1]).toEqual(['tenant-1', 'user-1', 'tomato soup']);
  });

  it('archives and unarchives only the owned recipe using archived_at', async () => {
    const owned = { id: 'recipe-1', tenant_id: 'tenant-1', user_id: 'user-1' };
    for (const archived of [true, false]) {
      const clientQuery = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [owned] });
      mockTransaction(clientQuery);
      await setPersistentRecipeArchived('recipe-1', recipeScope, archived);
      const [sql, params] = clientQuery.mock.calls[1] as [string, unknown[]];
      expect(sql).toContain('where id = $2 and tenant_id = $3 and user_id = $4');
      expect(sql).toContain('set archived_at = $1');
      expect(params[0] === null).toBe(!archived);
    }
  });

  it('returns null for out-of-scope rows and maps conflicts to safe typed errors', async () => {
    const missingQuery = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    mockTransaction(missingQuery);
    await expect(setPersistentRecipeArchived('foreign-recipe', recipeScope, true)).resolves.toBeNull();

    const conflictQuery = vi.fn().mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce({
      code: '23505', message: 'sensitive database detail',
    });
    mockTransaction(conflictQuery);
    await expect(createPersistentRecipe(recipeScope, recipeContent)).rejects.toMatchObject({
      name: 'RecipeRepositoryError', code: 'conflict', message: 'Recipe changed concurrently. Please retry.',
    });
  });

  it('restores a selected version by appending its contents and preserves immutable history', async () => {
    const selected = {
      id: 'old-version', recipe_id: 'recipe-1', tenant_id: 'tenant-1', user_id: 'user-1',
      version_number: 1, title: 'Old title', instructions: 'Old instructions', servings: 3,
      ingredients: [{ name: 'Onion', quantity: '1' }], source_recipe_history_id: null,
    };
    const clientQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [selected] })
      .mockResolvedValueOnce({ rows: [{ id: 'recipe-1', category: null, tags: [] }] })
      .mockResolvedValueOnce({ rows: [{ next_version: 2 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'new-version', version_number: 2 }] })
      .mockResolvedValueOnce({ rows: [] });
    mockTransaction(clientQuery);

    await restorePersistentRecipeVersion('recipe-1', 'old-version', recipeScope);

    expect(clientQuery.mock.calls[1]?.[1]).toEqual(['recipe-1', 'old-version', 'tenant-1', 'user-1']);
    expect(clientQuery.mock.calls[4]?.[0]).toContain('insert into public.user_recipe_versions');
    expect(clientQuery.mock.calls[4]?.[1]).toEqual([
      'recipe-1', 'tenant-1', 'user-1', 2, 'Old title', 'Old instructions', 3,
      JSON.stringify(selected.ingredients), null,
    ]);
    expect(clientQuery.mock.calls.map(([sql]) => String(sql)).join('\\n')).not.toMatch(/update\\s+public\\.user_recipe_versions|delete\\s+from\\s+public\\.user_recipe/i);
  });
});
