import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { PersistentRecipeScope } from '@/lib/db/repositories/recipeRepository';
import type { UserRecipeDetailDto, UserRecipeRow } from '@/lib/db/types';
const requireTenantMock = vi.fn<(...args: [NextRequest, string]) => Promise<{ tenantId: string }>>();
const requireUserMock = vi.fn<(...args: [NextRequest, string]) => Promise<{ id: string }>>();
const archiveMock = vi.fn<(id: string, scope: PersistentRecipeScope, archived: boolean) => Promise<UserRecipeRow | null>>();
const findMock = vi.fn<(id: string, scope: PersistentRecipeScope) => Promise<UserRecipeDetailDto | null>>();
vi.mock('@/lib/auth/server', () => ({ requireTenant: requireTenantMock, requireUser: requireUserMock }));
vi.mock('@/lib/db/repositories/recipeRepository', () => ({ setPersistentRecipeArchived: archiveMock, findPersistentRecipeDetail: findMock }));
const { PATCH } = await import('./route');
const id = '0d5f1ef0-a9f7-4cd3-97e8-5fd7bf0613db';
const row: UserRecipeRow = { id, tenant_id: 'hidden', user_id: 'hidden', category: null, tags: [], archived_at: 'now', created_at: 'now', updated_at: 'now' };
const detail: UserRecipeDetailDto = { ...row, current_version: { id, recipe_id: id, tenant_id: 'hidden', user_id: 'hidden', version_number: 1, title: 'A', instructions: 'B', servings: null, ingredients: [], source_recipe_history_id: null, created_at: 'now' } };
const req = (archived: unknown) => new NextRequest(`https://app.test/api/recipes/${id}/archive`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived }) });
const ctx = () => ({ params: Promise.resolve({ id }) });
beforeEach(() => { vi.clearAllMocks(); requireTenantMock.mockResolvedValue({ tenantId: 'tenant-1' }); requireUserMock.mockResolvedValue({ id: 'user-1' }); archiveMock.mockResolvedValue(row); findMock.mockResolvedValue(detail); });
describe('/api/recipes/[id]/archive', () => {
  it.each([true, false])('toggles archived=%s through archived_at and returns public detail', async (archived) => {
    const response = await PATCH(req(archived), ctx());
    expect(response.status).toBe(200);
    expect(archiveMock).toHaveBeenCalledWith(id, { tenantId: 'tenant-1', userId: 'user-1' }, archived);
    const body = await response.json() as { recipe: Record<string, unknown> };
    expect(body.recipe).not.toHaveProperty('user_id');
  });
  it('rejects malformed bodies and returns 404 for inaccessible recipes', async () => {
    expect((await PATCH(req('yes'), ctx())).status).toBe(400);
    archiveMock.mockResolvedValueOnce(null);
    expect((await PATCH(req(true), ctx())).status).toBe(404);
  });
  it('maps conflicts and unexpected errors without exposing details', async () => {
    archiveMock.mockRejectedValueOnce(Object.assign(new Error('conflict'), { name: 'RecipeRepositoryError', code: 'conflict' }));
    const conflict = await PATCH(req(true), ctx());
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: 'Recipe conflict' });
    archiveMock.mockRejectedValueOnce(new Error('db secret'));
    const failed = await PATCH(req(false), ctx());
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: 'Unable to archive recipe' });
  });
});
