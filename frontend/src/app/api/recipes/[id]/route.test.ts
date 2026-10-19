import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { PersistentRecipeContent, PersistentRecipeScope } from '@/lib/db/repositories/recipeRepository';
import type { UserRecipeDetailDto, UserRecipeVersionRow } from '@/lib/db/types';

const requireTenantMock = vi.fn<(...args: [NextRequest, string]) => Promise<{ tenantId: string }>>();
const requireUserMock = vi.fn<(...args: [NextRequest, string]) => Promise<{ id: string }>>();
const findMock = vi.fn<(id: string, scope: PersistentRecipeScope) => Promise<UserRecipeDetailDto | null>>();
const appendMock = vi.fn<(id: string, scope: PersistentRecipeScope, content: PersistentRecipeContent) => Promise<UserRecipeVersionRow | null>>();
vi.mock('@/lib/auth/server', () => ({ requireTenant: requireTenantMock, requireUser: requireUserMock }));
vi.mock('@/lib/db/repositories/recipeRepository', () => ({ findPersistentRecipeDetail: findMock, appendPersistentRecipeVersion: appendMock }));
const { GET, PATCH } = await import('./route');
const id = '0d5f1ef0-a9f7-4cd3-97e8-5fd7bf0613db';
const version: UserRecipeVersionRow = {
  id: '1d5f1ef0-a9f7-4cd3-97e8-5fd7bf0613db', recipe_id: id, tenant_id: 'hidden', user_id: 'hidden', version_number: 2,
  title: 'New', instructions: 'Bake', servings: 2, ingredients: [], source_recipe_history_id: null, created_at: '2026-01-02T00:00:00.000Z',
};
const detail: UserRecipeDetailDto = {
  id, tenant_id: 'hidden', user_id: 'hidden', category: null, tags: [], archived_at: null,
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z', current_version: version,
};
const req = (init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(`https://app.test/api/recipes/${id}`, init);
const ctx = (recipeId = id) => ({ params: Promise.resolve({ id: recipeId }) });

beforeEach(() => {
  vi.clearAllMocks();
  requireTenantMock.mockResolvedValue({ tenantId: 'tenant-1' });
  requireUserMock.mockResolvedValue({ id: 'user-1' });
  findMock.mockResolvedValue(detail);
  appendMock.mockResolvedValue(version);
});

describe('/api/recipes/[id]', () => {
  it('returns scoped details without ownership identifiers', async () => {
    const response = await GET(req(), ctx());
    expect(response.status).toBe(200);
    expect(findMock).toHaveBeenCalledWith(id, { tenantId: 'tenant-1', userId: 'user-1' });
    const body = await response.json() as { recipe: Record<string, unknown> };
    expect(body.recipe).not.toHaveProperty('tenant_id');
  });

  it('validates IDs and hides missing or foreign recipes as 404', async () => {
    expect((await GET(req(), ctx('bad-id'))).status).toBe(400);
    findMock.mockResolvedValueOnce(null);
    const missing = await GET(req(), ctx());
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'Recipe not found' });
  });

  it('appends an immutable edit version and returns the resulting detail', async () => {
    const response = await PATCH(req({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      title: 'New', instructions: 'Bake', servings: 2, ingredients: [], category: 'Dinner', tags: [],
    }) }), ctx());
    expect(response.status).toBe(200);
    expect(appendMock).toHaveBeenCalledWith(id, { tenantId: 'tenant-1', userId: 'user-1' }, expect.objectContaining({ title: 'New' }));
    const body = await response.json() as { version: { version_number: number } };
    expect(body.version.version_number).toBe(2);
  });

  it('rejects invalid payloads and maps conflict / unknown failures safely', async () => {
    expect((await PATCH(req({ method: 'PATCH', body: '{"title":"bad"}' }), ctx())).status).toBe(400);
    appendMock.mockRejectedValueOnce(Object.assign(new Error('conflict'), { name: 'RecipeRepositoryError', code: 'conflict' }));
    const conflict = await PATCH(req({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'New', instructions: 'Bake', ingredients: [] }) }), ctx());
    expect(conflict.status).toBe(409);
    appendMock.mockRejectedValueOnce(new Error('database secrets'));
    const failed = await PATCH(req({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'New', instructions: 'Bake', ingredients: [] }) }), ctx());
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: 'Unable to update recipe' });
  });

  it('returns 401 when authentication fails', async () => {
    requireTenantMock.mockRejectedValueOnce(new Error('Unauthorized'));
    expect((await GET(req(), ctx())).status).toBe(401);
  });
});
