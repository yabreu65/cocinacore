import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCurrentUser = vi.fn();
const listInventory = vi.fn();
const listRecipes = vi.fn();
const findProfile = vi.fn();
const findTenant = vi.fn();

vi.mock('@/lib/auth/server', () => ({ getCurrentUser }));
vi.mock('@/lib/db/repositories/inventoryRepository', () => ({
  listInventoryItemsByTenant: listInventory,
}));
vi.mock('@/lib/db/repositories/recipeRepository', () => ({
  listRecipeHistoryByTenant: listRecipes,
}));
vi.mock('@/lib/db/repositories/culinaryProfileRepository', () => ({
  findCulinaryProfileByUserId: findProfile,
}));
vi.mock('@/lib/db/repositories/tenantRepository', () => ({ findTenantById: findTenant }));

const { GET } = await import('./route');

describe('GET /api/dashboard', () => {
  beforeEach(() => {
    getCurrentUser.mockReset().mockResolvedValue({
      id: 'user-1',
      fullName: 'Example',
      tenant: { tenantId: 'tenant-1' },
    });
    listInventory.mockReset().mockResolvedValue(
      Array.from({ length: 12 }, (_, index) => ({
        id: `item-${index}`,
        ingredient_name: `Ingredient ${index}`,
        quantity: `${index}`,
      }))
    );
    listRecipes.mockReset().mockResolvedValue([]);
    findProfile.mockReset().mockResolvedValue(null);
    findTenant.mockReset().mockResolvedValue(null);
  });

  it('uses the authenticated identity for inventory and preserves the first ten in order', async () => {
    const response = await GET();
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(getCurrentUser).toHaveBeenCalledOnce();
    expect(listInventory).toHaveBeenCalledWith(
      'tenant-1',
      undefined,
      undefined,
      {},
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
      }
    );
    expect(body).toEqual({
      userId: 'user-1',
      fullName: 'Example',
      tenantId: 'tenant-1',
      tenantType: 'home',
      trialEndsAt: null,
      inventory: Array.from({ length: 10 }, (_, index) => ({
        id: `item-${index}`,
        name: `Ingredient ${index}`,
        quantity: `${index}`,
      })),
      recentRecipes: [],
      pdfCount: 0,
      latestPdfs: [],
      tenantBooks: [],
      culinaryProfile: { level: null, identity: [], preferred: [], avoid: [], goals: [] },
      activity: ['Dashboard cargado correctamente'],
    });
    expect(listRecipes).toHaveBeenCalledWith(
      'tenant-1',
      { userId: 'user-1' },
      { tenantId: 'tenant-1', userId: 'user-1' }
    );
    expect(findProfile).toHaveBeenCalledWith('user-1', 'tenant-1');
    expect(findTenant).toHaveBeenCalledWith('tenant-1', undefined, undefined, {
      tenantId: 'tenant-1',
      userId: 'user-1',
    });
  });

  it('rejects requests without a session before reads', async () => {
    getCurrentUser.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(listInventory).not.toHaveBeenCalled();
    expect(findTenant).not.toHaveBeenCalled();
  });

  it('returns an empty inventory for a user without a tenant', async () => {
    getCurrentUser.mockResolvedValue({ id: 'user-1', fullName: null, tenant: null });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      tenantId: null,
      inventory: [],
      recentRecipes: [],
    });
    expect(listInventory).not.toHaveBeenCalled();
    expect(listRecipes).not.toHaveBeenCalled();
    expect(findProfile).not.toHaveBeenCalled();
    expect(findTenant).not.toHaveBeenCalled();
  });
});
