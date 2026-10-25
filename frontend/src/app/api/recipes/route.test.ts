import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type {
  DuplicateRecipeCandidate,
  PersistentRecipeContent,
  PersistentRecipeListOptions,
  PersistentRecipeScope,
} from '@/lib/db/repositories/recipeRepository';
import type { UserRecipeDetailDto, UserRecipeListDto } from '@/lib/db/types';

const requireTenantMock = vi.fn<(...args: [NextRequest, string]) => Promise<{ tenantId: string }>>();
const requireUserMock = vi.fn<(...args: [NextRequest, string]) => Promise<{ id: string }>>();
const createMock = vi.fn<(scope: PersistentRecipeScope, content: PersistentRecipeContent) => Promise<UserRecipeDetailDto>>();
const listMock = vi.fn<(scope: PersistentRecipeScope, options: PersistentRecipeListOptions) => Promise<UserRecipeListDto[]>>();
const duplicatesMock = vi.fn<(scope: PersistentRecipeScope, title: string) => Promise<DuplicateRecipeCandidate[]>>();

vi.mock('@/lib/auth/server', () => ({ requireTenant: requireTenantMock, requireUser: requireUserMock }));
vi.mock('@/lib/db/repositories/recipeRepository', () => ({
  createPersistentRecipe: createMock,
  listPersistentRecipes: listMock,
  findDuplicatePersistentRecipeTitles: duplicatesMock,
}));

const { GET, POST } = await import('./route');
const recipeId = '0d5f1ef0-a9f7-4cd3-97e8-5fd7bf0613db';
const row: UserRecipeDetailDto = {
  id: recipeId, tenant_id: 'tenant-secret', user_id: 'user-secret', category: 'Dinner', tags: ['rice'],
  archived_at: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  current_version: {
    id: '1d5f1ef0-a9f7-4cd3-97e8-5fd7bf0613db', recipe_id: recipeId, tenant_id: 'tenant-secret', user_id: 'user-secret',
    version_number: 1, title: 'Rice', instructions: 'Cook it', servings: 2, ingredients: [{ name: 'Rice' }],
    source_recipe_history_id: null, created_at: '2026-01-01T00:00:00.000Z',
  },
};
function request(path: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(`https://app.example.test${path}`, init);
}

beforeEach(() => {
  vi.clearAllMocks();
  requireTenantMock.mockResolvedValue({ tenantId: 'tenant-1' });
  requireUserMock.mockResolvedValue({ id: 'user-1' });
  createMock.mockResolvedValue(row);
  listMock.mockResolvedValue([]);
  duplicatesMock.mockResolvedValue([{ recipeId, title: 'Rice', versionNumber: 1 }]);
});

describe('/api/recipes', () => {
  it('creates with authenticated ownership, advisory duplicates, and a public response', async () => {
    const response = await POST(request('/api/recipes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Rice', instructions: 'Cook it', servings: 2, ingredients: [{ name: 'Rice' }] }),
    }));
    expect(response.status).toBe(201);
    expect(createMock).toHaveBeenCalledWith({ tenantId: 'tenant-1', userId: 'user-1' }, expect.objectContaining({ title: 'Rice' }));
    const body = await response.json() as { recipe: Record<string, unknown>; warnings: { duplicates: unknown[] } };
    expect(body.recipe).not.toHaveProperty('tenant_id');
    expect(body.warnings.duplicates).toHaveLength(1);
  });

  it('does not reject creation when advisory duplicate lookup fails', async () => {
    duplicatesMock.mockRejectedValueOnce(new Error('private database details'));
    const response = await POST(request('/api/recipes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Rice', instructions: 'Cook it', ingredients: [] }),
    }));
    expect(response.status).toBe(201);
    const body = await response.json() as { warnings: { duplicates: unknown[] } };
    expect(body.warnings.duplicates).toEqual([]);
  });

  it('rejects invalid creation and returns 401 before repository access', async () => {
    const invalid = await POST(request('/api/recipes', { method: 'POST', body: '{"title":""}' }));
    expect(invalid.status).toBe(400);
    requireUserMock.mockRejectedValueOnce(new Error('Unauthorized'));
    const unauthenticated = await GET(request('/api/recipes'));
    expect(unauthenticated.status).toBe(401);
    expect(listMock).not.toHaveBeenCalled();
  });

  it('lists validated filters only within authenticated ownership', async () => {
    listMock.mockResolvedValueOnce([row]);
    const response = await GET(request('/api/recipes?search=rice&archived=all&limit=10&offset=2'));
    expect(response.status).toBe(200);
    expect(listMock).toHaveBeenCalledWith({ tenantId: 'tenant-1', userId: 'user-1' }, {
      search: 'rice', archived: 'all', limit: 10, offset: 2,
    });
    const body = await response.json() as { items: Array<Record<string, unknown>> };
    expect(body.items[0]).not.toHaveProperty('user_id');
    expect(body.items[0]).not.toHaveProperty('current_version.source_recipe_history_id');
  });

  it('rejects invalid list bounds and maps repository failures safely', async () => {
    expect((await GET(request('/api/recipes?limit=1000'))).status).toBe(400);
    listMock.mockRejectedValueOnce(new Error('SQL credentials leaked'));
    const failed = await GET(request('/api/recipes'));
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: 'Unable to list recipe' });
  });
});
