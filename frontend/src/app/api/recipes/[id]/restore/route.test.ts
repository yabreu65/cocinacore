import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { PersistentRecipeScope } from '@/lib/db/repositories/recipeRepository';
import type { UserRecipeDetailDto, UserRecipeVersionRow } from '@/lib/db/types';
const requireTenantMock = vi.fn<(...args: [NextRequest, string]) => Promise<{ tenantId: string }>>();
const requireUserMock = vi.fn<(...args: [NextRequest, string]) => Promise<{ id: string }>>();
const findMock = vi.fn<(id: string, scope: PersistentRecipeScope) => Promise<UserRecipeDetailDto | null>>();
const restoreMock = vi.fn<(id: string, versionId: string, scope: PersistentRecipeScope) => Promise<UserRecipeVersionRow | null>>();
vi.mock('@/lib/auth/server', () => ({ requireTenant: requireTenantMock, requireUser: requireUserMock }));
vi.mock('@/lib/db/repositories/recipeRepository', () => ({ findPersistentRecipeDetail: findMock, restorePersistentRecipeVersion: restoreMock }));
const { POST } = await import('./route');
const id = '0d5f1ef0-a9f7-4cd3-97e8-5fd7bf0613db';
const versionId = '1d5f1ef0-a9f7-4cd3-97e8-5fd7bf0613db';
const version: UserRecipeVersionRow = { id: versionId, recipe_id: id, tenant_id: 'hidden', user_id: 'hidden', version_number: 3, title: 'Restored', instructions: 'Bake', servings: null, ingredients: [], source_recipe_history_id: null, created_at: 'now' };
const detail: UserRecipeDetailDto = { id, tenant_id: 'hidden', user_id: 'hidden', category: null, tags: [], archived_at: null, created_at: 'now', updated_at: 'now', current_version: version };
const req = (body: string) => new NextRequest(`https://app.test/api/recipes/${id}/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
const ctx = (recipeId = id) => ({ params: Promise.resolve({ id: recipeId }) });
beforeEach(() => { vi.clearAllMocks(); requireTenantMock.mockResolvedValue({ tenantId: 'tenant-1' }); requireUserMock.mockResolvedValue({ id: 'user-1' }); findMock.mockResolvedValue(detail); restoreMock.mockResolvedValue(version); });
describe('/api/recipes/[id]/restore', () => {
  it('restores a scoped version by appending and returns the new version', async () => {
    const response = await POST(req(JSON.stringify({ versionId })), ctx());
    expect(response.status).toBe(200);
    expect(restoreMock).toHaveBeenCalledWith(id, versionId, { tenantId: 'tenant-1', userId: 'user-1' });
    const body = await response.json() as { version: { version_number: number } };
    expect(body.version.version_number).toBe(3);
  });
  it('validates selected version and returns generic 404 for foreign recipe or version', async () => {
    expect((await POST(req('{"versionId":"bad"}'), ctx())).status).toBe(400);
    restoreMock.mockResolvedValueOnce(null);
    expect((await POST(req(JSON.stringify({ versionId })), ctx())).status).toBe(404);
  });
  it('returns 401 when unauthenticated', async () => {
    requireTenantMock.mockRejectedValueOnce(new Error('Unauthorized'));
    expect((await POST(req(JSON.stringify({ versionId })), ctx())).status).toBe(401);
  });
});
