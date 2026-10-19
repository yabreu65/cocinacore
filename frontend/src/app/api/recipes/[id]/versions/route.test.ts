import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { PersistentRecipeScope } from '@/lib/db/repositories/recipeRepository';
import type { UserRecipeDetailDto, UserRecipeVersionRow } from '@/lib/db/types';
const requireTenantMock = vi.fn<(...args: [NextRequest, string]) => Promise<{ tenantId: string }>>();
const requireUserMock = vi.fn<(...args: [NextRequest, string]) => Promise<{ id: string }>>();
const findMock = vi.fn<(id: string, scope: PersistentRecipeScope) => Promise<UserRecipeDetailDto | null>>();
const versionsMock = vi.fn<(id: string, scope: PersistentRecipeScope) => Promise<UserRecipeVersionRow[]>>();
vi.mock('@/lib/auth/server', () => ({ requireTenant: requireTenantMock, requireUser: requireUserMock }));
vi.mock('@/lib/db/repositories/recipeRepository', () => ({ findPersistentRecipeDetail: findMock, listPersistentRecipeVersions: versionsMock }));
const { GET } = await import('./route');
const id = '0d5f1ef0-a9f7-4cd3-97e8-5fd7bf0613db';
const version: UserRecipeVersionRow = { id, recipe_id: id, tenant_id: 'hidden', user_id: 'hidden', version_number: 1, title: 'A', instructions: 'B', servings: null, ingredients: [], source_recipe_history_id: null, created_at: 'now' };
const detail: UserRecipeDetailDto = { id, tenant_id: 'hidden', user_id: 'hidden', category: null, tags: [], archived_at: null, created_at: 'now', updated_at: 'now', current_version: version };
const req = () => new NextRequest(`https://app.test/api/recipes/${id}/versions`);
const ctx = (recipeId = id) => ({ params: Promise.resolve({ id: recipeId }) });
beforeEach(() => { vi.clearAllMocks(); requireTenantMock.mockResolvedValue({ tenantId: 'tenant-1' }); requireUserMock.mockResolvedValue({ id: 'user-1' }); findMock.mockResolvedValue(detail); versionsMock.mockResolvedValue([version]); });
describe('/api/recipes/[id]/versions', () => {
  it('checks parent ownership before returning scoped versions', async () => {
    const response = await GET(req(), ctx());
    expect(response.status).toBe(200);
    expect(versionsMock).toHaveBeenCalledWith(id, { tenantId: 'tenant-1', userId: 'user-1' });
    const body = await response.json() as { versions: Array<Record<string, unknown>> };
    expect(body.versions[0]).not.toHaveProperty('tenant_id');
  });
  it('returns 404 for inaccessible parent instead of an empty history', async () => {
    findMock.mockResolvedValueOnce(null);
    expect((await GET(req(), ctx())).status).toBe(404);
    expect(versionsMock).not.toHaveBeenCalled();
  });
  it('validates id and maps unauthenticated access', async () => {
    expect((await GET(req(), ctx('invalid'))).status).toBe(400);
    requireUserMock.mockRejectedValueOnce(new Error('Unauthorized'));
    expect((await GET(req(), ctx())).status).toBe(401);
  });
});
