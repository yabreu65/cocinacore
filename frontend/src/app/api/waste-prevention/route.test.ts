import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mockRequireUser = vi.fn();
const mockListInventory = vi.fn();
const mockListRecipes = vi.fn();
const mockFindProfile = vi.fn();
const mockFindTerms = vi.fn();

vi.mock('@/lib/auth/server', () => ({ requireUser: mockRequireUser }));
vi.mock('@/lib/db/repositories/inventoryRepository', () => ({
  MAX_WASTE_PREVENTION_INVENTORY_LIMIT: 100,
  listWastePreventionInventoryByTenant: mockListInventory,
}));
vi.mock('@/lib/db/repositories/recipeRepository', () => ({
  listPersistentRecipes: mockListRecipes,
}));
vi.mock('@/lib/db/repositories/culinaryProfileRepository', () => ({
  findCulinaryProfileByUserId: mockFindProfile,
  MAX_WASTE_PREVENTION_PROFILE_TERMS: 100,
  listWastePreventionCulinaryProfileTermsByUserId: mockFindTerms,
}));
vi.mock('@/lib/serverLogger', () => ({ serverLogger: { warn: vi.fn() } }));

const { GET } = await import('./route');

type RouteBody = {
  report: {
    suggestions: Array<Record<string, unknown>>;
    lots: Array<Record<string, unknown>>;
  };
  profileConfigured: boolean;
};

async function readBody(response: Response): Promise<RouteBody> {
  const raw: unknown = await response.json();
  if (typeof raw !== 'object' || raw === null || !('report' in raw)) {
    throw new Error('Unexpected response body');
  }
  return raw as RouteBody;
}

const user = {
  id: 'user-1',
  email: 'user@example.test',
  fullName: null,
  tenant: { tenantId: 'tenant-1', role: 'owner', tenantType: 'home', onboardingCompleted: true },
  termsAcceptedAt: null,
  termsVersion: null,
  onboardingCompleted: true,
};

function request(query = 'timeZone=UTC'): NextRequest {
  return new Request(
    `https://app.example.test/api/waste-prevention?${query}`
  ) as unknown as NextRequest;
}

function inventory(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lot-1',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    ingredient_name: 'Tomato',
    quantity: '2',
    unit: 'unidad',
    category: 'Verduras',
    expiration_date: '2026-10-27',
    estimated_unit_price: null,
    purchase_location: null,
    low_stock_threshold: null,
    normalized_name: 'tomato',
    notes: null,
    created_at: '2026-10-20T00:00:00.000Z',
    updated_at: '2026-10-20T00:00:00.000Z',
    ...overrides,
  };
}

function recipe(overrides: Record<string, unknown> = {}) {
  return {
    id: 'recipe-1',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    category: null,
    tags: [],
    archived_at: null,
    created_at: '2026-10-20T00:00:00.000Z',
    updated_at: '2026-10-20T00:00:00.000Z',
    current_version: {
      id: 'version-1',
      version_number: 1,
      title: 'Tomato rice',
      instructions: 'Cook',
      servings: 2,
      ingredients: [{ name: 'Tomato', quantity: '1', unit: 'unidad' }],
      source_recipe_history_id: null,
      created_at: '2026-10-20T00:00:00.000Z',
    },
    ...overrides,
  };
}

describe('GET /api/waste-prevention', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-26T12:00:00.000Z'));
    mockRequireUser.mockReset().mockResolvedValue(user);
    mockListInventory.mockReset().mockResolvedValue([inventory()]);
    mockListRecipes.mockReset().mockResolvedValue([recipe()]);
    mockFindProfile.mockReset().mockResolvedValue({
      user_id: 'user-1',
      tenant_id: 'tenant-1',
      allergies: ['peanut'],
      disliked_ingredients: [],
    });
    mockFindTerms.mockReset().mockResolvedValue([
      { preference_type: 'avoid', term_label: 'coriander' },
      { preference_type: 'prefer', term_label: 'tomato' },
    ]);
  });

  afterEach(() => vi.useRealTimers());

  it('requires authentication before reading tenant data', async () => {
    mockRequireUser.mockRejectedValue(new Error('unauthorized'));

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mockListInventory).not.toHaveBeenCalled();
    expect(mockListRecipes).not.toHaveBeenCalled();
  });

  it('rejects users without a tenant before reading data', async () => {
    mockRequireUser.mockResolvedValue({ ...user, tenant: null });

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(mockListInventory).not.toHaveBeenCalled();
    expect(mockListRecipes).not.toHaveBeenCalled();
  });

  it('rejects invalid query controls before database reads', async () => {
    expect((await GET(request('timeZone=Not%2FAZone'))).status).toBe(400);
    expect((await GET(request('timeZone=UTC&dueSoonDays=0'))).status).toBe(400);
    expect(mockListInventory).not.toHaveBeenCalled();
  });

  it('scopes reads to the authenticated tenant and user and returns a read-only projection', async () => {
    const response = await GET(request('timeZone=UTC&dueSoonDays=5'));
    const body = await readBody(response);

    expect(response.status).toBe(200);
    expect(mockRequireUser).toHaveBeenCalledOnce();
    expect(mockListInventory).toHaveBeenCalledWith('tenant-1', undefined, {
      tenantId: 'tenant-1',
      userId: 'user-1',
    });
    expect(mockListRecipes).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', userId: 'user-1' },
      { archived: 'active', limit: 100, offset: 0, includeSentinel: true }
    );
    expect(body.profileConfigured).toBe(true);
    expect(body.report.suggestions[0]).toMatchObject({ recipeId: 'recipe-1', coverage: 'full' });
    expect(body.report.lots[0]).not.toHaveProperty('tenantId');
  });

  it('fails closed when the bounded inventory projection is truncated', async () => {
    mockListInventory.mockResolvedValue(Array.from({ length: 101 }, () => inventory()));

    const response = await GET(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'Unable to load waste prevention data' });
  });

  it('fails closed when the profile returned for the user belongs to another tenant', async () => {
    mockFindProfile.mockResolvedValue({
      user_id: 'user-1',
      tenant_id: 'tenant-2',
      allergies: ['tomato'],
      disliked_ingredients: [],
    });

    const response = await GET(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'Unable to load waste prevention data' });
  });

  it('keeps expired ingredients visible but never recommends a recipe that only uses them', async () => {
    mockListInventory.mockResolvedValue([inventory({ expiration_date: '2026-10-25' })]);

    const response = await GET(request());
    const body = await readBody(response);

    expect(body.report.lots[0]).toMatchObject({ status: 'expired', calendarDate: '2026-10-25' });
    expect(body.report.suggestions).toEqual([]);
  });

  it('keeps inventory visible but suppresses recipe suggestions without a culinary profile', async () => {
    mockFindProfile.mockResolvedValue(null);

    const response = await GET(request());
    const body = await readBody(response);

    expect(response.status).toBe(200);
    expect(body.profileConfigured).toBe(false);
    expect(body.report.lots).toHaveLength(1);
    expect(body.report.suggestions).toEqual([]);
  });

  it('fails closed when profile restrictions exceed the bounded read', async () => {
    mockFindTerms.mockResolvedValue(
      Array.from({ length: 101 }, (_, index) => ({
        preference_type: 'avoid',
        term_label: `term-${index}`,
      }))
    );

    const response = await GET(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'Unable to load waste prevention data' });
  });

  it('returns an explicit server error when a read fails', async () => {
    mockListRecipes.mockRejectedValue(new Error('database unavailable'));

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Unable to load waste prevention data' });
  });
});
