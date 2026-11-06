import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecipeInventoryItemRow, UserMealPlanRow, UserRecipeDetailDto } from '@/lib/db/types';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  findPersistentRecipeDetail: vi.fn(),
  findMealPlanByIdForUserAndTenant: vi.fn(),
  listInventoryItemsByTenant: vi.fn(),
  findCulinaryProfileByUserId: vi.fn(),
  listWastePreventionCulinaryProfileTermsByUserId: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/db/repositories/recipeRepository', () => ({
  findPersistentRecipeDetail: mocks.findPersistentRecipeDetail,
}));
vi.mock('@/lib/db/repositories/mealPlanRepository', () => ({
  findMealPlanByIdForUserAndTenant: mocks.findMealPlanByIdForUserAndTenant,
}));
vi.mock('@/lib/db/repositories/inventoryRepository', () => ({
  listInventoryItemsByTenant: mocks.listInventoryItemsByTenant,
  MAX_WASTE_PREVENTION_INVENTORY_LIMIT: 100,
}));
vi.mock('@/lib/db/repositories/culinaryProfileRepository', () => ({
  findCulinaryProfileByUserId: mocks.findCulinaryProfileByUserId,
  listWastePreventionCulinaryProfileTermsByUserId:
    mocks.listWastePreventionCulinaryProfileTermsByUserId,
  MAX_WASTE_PREVENTION_PROFILE_TERMS: 100,
}));

import { GET } from './route';

const recipeId = '00000000-0000-4000-8000-000000000001';

const recipe: UserRecipeDetailDto = {
  id: recipeId,
  tenant_id: 'tenant-1',
  user_id: 'user-1',
  category: null,
  tags: [],
  archived_at: null,
  created_at: '2026-10-28T00:00:00.000Z',
  updated_at: '2026-10-28T00:00:00.000Z',
  current_version: {
    id: '00000000-0000-4000-8000-000000000002',
    recipe_id: recipeId,
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    version_number: 1,
    title: 'Test recipe',
    instructions: 'Cook it.',
    servings: 2,
    ingredients: [{ name: 'Tomato', quantity: '1', unit: 'kg' }],
    source_recipe_history_id: null,
    created_at: '2026-10-28T00:00:00.000Z',
  },
};

const inventory: RecipeInventoryItemRow = {
  id: 'inventory-1',
  tenant_id: 'tenant-1',
  user_id: 'user-1',
  ingredient_name: 'Tomato',
  quantity: '1 kg',
  unit: 'kg',
  category: null,
  expiration_date: '2026-11-02',
  estimated_unit_price: null,
  purchase_location: null,
  low_stock_threshold: null,
  normalized_name: 'tomato',
  notes: null,
  created_at: '2026-10-28T00:00:00.000Z',
  updated_at: '2026-10-28T00:00:00.000Z',
};

const unconfirmedPlan: UserMealPlanRow = {
  id: '00000000-0000-4000-8000-000000000010',
  tenant_id: 'tenant-1',
  user_id: 'user-1',
  people_count: 2,
  period: 'week',
  mode: 'balanced_ai',
  base_cuisine: 'home',
  fusion_cuisines: [],
  fusion_intensity: 'sutil',
  goal: null,
  restrictions: [],
  inventory_snapshot: {},
  calendar_payload: {},
  consumption_payload: {},
  ai_content: null,
  created_at: '2026-10-28T00:00:00.000Z',
  updated_at: '2026-10-28T00:00:00.000Z',
};

function request(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/cooking-intent-preview?${query}`);
}

describe('GET /api/cooking-intent-preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({
      id: 'user-1',
      tenant: { tenantId: 'tenant-1', role: 'owner' },
    });
    mocks.findPersistentRecipeDetail.mockResolvedValue(recipe);
    mocks.listInventoryItemsByTenant.mockResolvedValue([inventory]);
    mocks.findCulinaryProfileByUserId.mockResolvedValue(null);
    mocks.listWastePreventionCulinaryProfileTermsByUserId.mockResolvedValue([]);
  });

  it('rejects anonymous requests before loading private records', async () => {
    mocks.requireUser.mockRejectedValue(new Error('unauthorized'));
    const response = await GET(request(`source=recipe&recipeId=${recipeId}`));
    expect(response.status).toBe(401);
    expect(mocks.findPersistentRecipeDetail).not.toHaveBeenCalled();
  });

  it('validates the source and bounded portions', async () => {
    const response = await GET(request('source=recipe&recipeId=bad&portions=101'));
    expect(response.status).toBe(400);
    expect(mocks.findPersistentRecipeDetail).not.toHaveBeenCalled();
  });

  it('returns an authenticated read-only preview for the scoped recipe', async () => {
    const response = await GET(request(`source=recipe&recipeId=${recipeId}&portions=4`));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { preview: Record<string, unknown> };
    expect(body.preview).toMatchObject({
      source: 'saved_recipe',
      title: 'Test recipe',
      portions: { original: 2, requested: 4 },
    });
    expect(mocks.requireUser).toHaveBeenCalledOnce();
    expect(mocks.listInventoryItemsByTenant).toHaveBeenCalledWith(
      'tenant-1',
      101,
      undefined,
      {},
      { tenantId: 'tenant-1', userId: 'user-1' }
    );
  });

  it('rejects a truncated inventory projection', async () => {
    mocks.listInventoryItemsByTenant.mockResolvedValue(
      Array.from({ length: 101 }, () => inventory)
    );
    const response = await GET(request(`source=recipe&recipeId=${recipeId}`));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'Unable to load bounded preview data' });
  });

  it('does not reveal a recipe outside the user and tenant scope', async () => {
    mocks.findPersistentRecipeDetail.mockResolvedValue(null);
    const response = await GET(request(`source=recipe&recipeId=${recipeId}`));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Recipe not found' });
  });

  it('rejects a meal slot whose persisted plan is not confirmed', async () => {
    mocks.findMealPlanByIdForUserAndTenant.mockResolvedValue(unconfirmedPlan);
    const response = await GET(
      request(
        'source=meal_slot&mealPlanId=00000000-0000-4000-8000-000000000010&dayIndex=1&mealType=lunch'
      )
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'Meal plan schedule is not confirmed' });
  });
});
