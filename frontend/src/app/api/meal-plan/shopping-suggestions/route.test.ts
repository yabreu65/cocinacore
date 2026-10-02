import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { UserMealPlanRow } from '@/lib/db/types';

const requireUserMock = vi.fn();
const findMealPlanByIdForUserAndTenantMock = vi.fn();
const listInventoryItemsByTenantMock = vi.fn();
const addMealPlanShoppingItemsMock = vi.fn();
const listShoppingListItemsMock = vi.fn();

vi.mock('@/lib/auth/server', () => ({ requireUser: requireUserMock }));
vi.mock('@/lib/db/repositories/mealPlanRepository', () => ({
  findMealPlanByIdForUserAndTenant: findMealPlanByIdForUserAndTenantMock,
}));
vi.mock('@/lib/db/repositories/inventoryRepository', () => ({
  listInventoryItemsByTenant: listInventoryItemsByTenantMock,
}));
vi.mock('@/lib/db/repositories/shoppingListRepository', () => ({
  addMealPlanShoppingItems: addMealPlanShoppingItemsMock,
  listShoppingListItems: listShoppingListItemsMock,
}));

const { GET, POST } = await import('./route');

const planId = '123e4567-e89b-42d3-a456-426614174000';

function persistedPlan(overrides: Partial<UserMealPlanRow> = {}): UserMealPlanRow {
  return {
    id: planId,
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    people_count: 50,
    period: 'week',
    mode: 'balanced_ai',
    base_cuisine: 'Latinoamericana',
    fusion_cuisines: [],
    fusion_intensity: 'media',
    goal: null,
    restrictions: [],
    inventory_snapshot: { inventoryLines: ['do-not-use-snapshot'] },
    calendar_payload: {
      period: 'week',
      dayCount: 7,
      days: Array.from({ length: 7 }, (_, index) => ({
        dayIndex: index + 1,
        label: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'][index],
        meals: [
          {
            mealType: 'breakfast',
            title: 'Avena del día',
            description: null,
            ingredients:
              index === 0
                ? [
                    { name: 'Arroz', quantity: 2, unit: 'kg' },
                    { name: 'Harina', quantity: 1, unit: 'kg' },
                    { name: 'Sal', quantity: null, unit: null },
                  ]
                : [{ name: `Otro ${index}`, quantity: 1, unit: 'unidad' }],
          },
          {
            mealType: 'lunch',
            title: 'Almuerzo',
            description: null,
            ingredients: [
              { name: index === 0 ? 'Aceite' : `Almuerzo ${index}`, quantity: 1, unit: 'l' },
            ],
          },
          {
            mealType: 'dinner',
            title: 'Cena',
            description: null,
            ingredients: [
              { name: index === 0 ? 'Papa' : `Cena ${index}`, quantity: 1, unit: 'kg' },
            ],
          },
        ],
      })),
    },
    consumption_payload: {},
    ai_content: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function inventoryItem(ingredient_name: string, quantity: string, unit: string) {
  return {
    id: `inventory-${ingredient_name}`,
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    ingredient_name,
    quantity,
    unit,
    category: null,
    expiration_date: null,
    estimated_unit_price: null,
    purchase_location: null,
    low_stock_threshold: null,
    normalized_name: null,
    notes: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function request(id = planId): NextRequest {
  return new Request(
    `https://app.example.test/api/meal-plan/shopping-suggestions?mealPlanId=${id}`
  ) as unknown as NextRequest;
}

function consumedBreakfastPayload() {
  return {
    '1:breakfast': {
      consumedAt: '2026-09-30T20:00:00.000Z',
      dayIndex: 1,
      mealType: 'breakfast',
      mealTitle: 'Avena del día',
      decrements: [],
      skipped: [],
    },
  };
}

describe('GET /api/meal-plan/shopping-suggestions', () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    findMealPlanByIdForUserAndTenantMock.mockReset();
    listInventoryItemsByTenantMock.mockReset();
    addMealPlanShoppingItemsMock.mockReset();
    listShoppingListItemsMock.mockReset();
    listShoppingListItemsMock.mockResolvedValue([]);
    addMealPlanShoppingItemsMock.mockResolvedValue({ added: [], alreadyPresent: [] });
    requireUserMock.mockResolvedValue({ id: 'user-1', tenant: { tenantId: 'tenant-1' } });
    findMealPlanByIdForUserAndTenantMock.mockResolvedValue(persistedPlan());
    listInventoryItemsByTenantMock.mockResolvedValue([
      inventoryItem('Arroz', '500', 'g'),
      inventoryItem('Harina', '2', 'kg'),
      inventoryItem('Aceite', '2', 'l'),
    ]);
  });

  it('returns actionable buy/review candidates from the current tenant inventory without ownership data', async () => {
    const response = await GET(request() as unknown as NextRequest);
    expect(response.status).toBe(200);
    expect(findMealPlanByIdForUserAndTenantMock).toHaveBeenCalledWith(planId, 'user-1', 'tenant-1');
    expect(listInventoryItemsByTenantMock).toHaveBeenCalledWith('tenant-1');
    expect(listShoppingListItemsMock).toHaveBeenCalledWith('tenant-1', 'user-1');
    const body = (await response.json()) as { items: Array<Record<string, unknown>> };
    expect(body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedName: 'arroz',
          status: 'buy',
          quantityToBuy: 1.5,
          unit: 'kg',
          usedInRecipes: expect.arrayContaining<string>([
            'Lunes · Desayuno · Avena del día',
          ]) as unknown,
        }),
        expect.objectContaining({ normalizedName: 'sal', status: 'review', quantityToBuy: null }),
      ])
    );
    expect(
      body.items.some(
        (item) => item.normalizedName === 'harina' || item.normalizedName === 'aceite'
      )
    ).toBe(false);
    expect(
      body.items.every((item) => !('tenant_id' in item) && !('user_id' in item) && !('id' in item))
    ).toBe(true);
    expect(JSON.stringify(body)).not.toContain('do-not-use-snapshot');
  });

  it('marks only exact-source normalized shopping rows with their current status', async () => {
    listShoppingListItemsMock.mockResolvedValue([
      {
        id: 'private-row',
        tenant_id: 'tenant-1',
        user_id: 'user-1',
        source: `meal-plan:${planId}`,
        ingredient_name: ' ARROZ ',
        status: 'pending',
      },
      {
        id: 'purchased-row',
        tenant_id: 'tenant-1',
        user_id: 'user-1',
        source: `meal-plan:${planId}`,
        ingredient_name: 'Sal',
        status: 'purchased',
      },
      {
        id: 'manual-row',
        tenant_id: 'tenant-1',
        user_id: 'user-1',
        source: 'manual',
        ingredient_name: 'Harina',
        status: 'pending',
      },
    ]);

    const response = await GET(request() as unknown as NextRequest);
    const body = (await response.json()) as { items: Array<Record<string, unknown>> };
    expect(body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedName: 'arroz',
          alreadyPresent: true,
          shoppingStatus: 'pending',
        }),
        expect.objectContaining({
          normalizedName: 'sal',
          alreadyPresent: true,
          shoppingStatus: 'purchased',
        }),
      ])
    );
    expect(
      body.items.every((item) => !('tenant_id' in item) && !('user_id' in item) && !('id' in item))
    ).toBe(true);
  });

  it('rejects unauthenticated callers before database reads', async () => {
    requireUserMock.mockRejectedValue(new Error('Unauthorized'));
    const response = await GET(request() as unknown as NextRequest);
    expect(response.status).toBe(401);
    expect(findMealPlanByIdForUserAndTenantMock).not.toHaveBeenCalled();
    expect(listInventoryItemsByTenantMock).not.toHaveBeenCalled();
  });

  it('rejects invalid UUID before lookup', async () => {
    const response = await GET(request('not-a-uuid') as unknown as NextRequest);
    expect(response.status).toBe(400);
    expect(findMealPlanByIdForUserAndTenantMock).not.toHaveBeenCalled();
  });

  it('returns a generic not-found response for a plan not owned by the authenticated user', async () => {
    findMealPlanByIdForUserAndTenantMock.mockResolvedValue(null);
    const response = await GET(request() as unknown as NextRequest);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Menú no encontrado.' });
    expect(listInventoryItemsByTenantMock).not.toHaveBeenCalled();
  });

  it('recalculates candidates when current inventory changes', async () => {
    listInventoryItemsByTenantMock.mockResolvedValue([
      inventoryItem('Arroz', '2', 'kg'),
      inventoryItem('Harina', '1', 'kg'),
      inventoryItem('Aceite', '1', 'l'),
    ]);
    const response = await GET(request() as unknown as NextRequest);
    const body = (await response.json()) as { items: Array<{ normalizedName: string }> };
    expect(body.items.some((item) => item.normalizedName === 'arroz')).toBe(false);
    expect(body.items.some((item) => item.normalizedName === 'harina')).toBe(false);
    expect(body.items.some((item) => item.normalizedName === 'aceite')).toBe(false);
  });

  it('does not suggest ingredients from meals that are already consumed', async () => {
    findMealPlanByIdForUserAndTenantMock.mockResolvedValue(
      persistedPlan({ consumption_payload: consumedBreakfastPayload() })
    );
    const response = await GET(request() as unknown as NextRequest);
    const body = (await response.json()) as { items: Array<{ normalizedName: string }> };
    expect(body.items.some((item) => item.normalizedName === 'arroz')).toBe(false);
    expect(body.items.some((item) => item.normalizedName === 'sal')).toBe(false);
    expect(body.items.some((item) => item.normalizedName === 'papa')).toBe(true);
  });
});

function postRequest(body: unknown): NextRequest {
  return new Request('https://app.example.test/api/meal-plan/shopping-suggestions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe('POST /api/meal-plan/shopping-suggestions', () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    findMealPlanByIdForUserAndTenantMock.mockReset();
    listInventoryItemsByTenantMock.mockReset();
    addMealPlanShoppingItemsMock.mockReset();
    listShoppingListItemsMock.mockReset();
    requireUserMock.mockResolvedValue({ id: 'user-1', tenant: { tenantId: 'tenant-1' } });
    findMealPlanByIdForUserAndTenantMock.mockResolvedValue(persistedPlan());
    listInventoryItemsByTenantMock.mockResolvedValue([
      inventoryItem('Arroz', '500', 'g'),
      inventoryItem('Harina', '2', 'kg'),
      inventoryItem('Aceite', '2', 'l'),
    ]);
    addMealPlanShoppingItemsMock.mockResolvedValue({ added: [], alreadyPresent: [] });
  });

  it('recomputes current candidates and persists only selected actionable keys with server-owned data', async () => {
    const response = await POST(
      postRequest({ mealPlanId: planId, selectedItems: ['arroz', 'sal', 'harina'] })
    );
    expect(response.status).toBe(200);
    expect(listInventoryItemsByTenantMock).toHaveBeenCalledWith('tenant-1');
    expect(addMealPlanShoppingItemsMock).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      userId: 'user-1',
      source: `meal-plan:${planId}`,
      items: [
        { ingredientName: 'Arroz', quantity: '1.5 kg' },
        { ingredientName: 'Sal', quantity: null },
      ],
    });
    expect(await response.json()).toEqual({ added: [], alreadyPresent: [], ignored: ['harina'] });
  });

  it('rejects malformed, empty, invalid, and spoofed confirmation bodies', async () => {
    for (const body of [
      { mealPlanId: 'bad', selectedItems: ['arroz'] },
      { mealPlanId: planId, selectedItems: [] },
      { mealPlanId: planId, selectedItems: [' Arroz '] },
      { mealPlanId: planId, selectedItems: ['arroz'], tenantId: 'tenant-2' },
      { mealPlanId: planId, selectedItems: ['arroz'], userId: 'user-2' },
      { mealPlanId: planId, selectedItems: ['arroz'], quantity: '9 kg' },
      { mealPlanId: planId, selectedItems: ['arroz'], source: 'manual' },
    ]) {
      const response = await POST(postRequest(body));
      expect(response.status).toBe(400);
    }
    expect(findMealPlanByIdForUserAndTenantMock).not.toHaveBeenCalled();
    expect(addMealPlanShoppingItemsMock).not.toHaveBeenCalled();
  });

  it('returns 401 before reads and generic 404 for an unavailable plan', async () => {
    requireUserMock.mockRejectedValueOnce(new Error('Unauthorized'));
    expect((await POST(postRequest({ mealPlanId: planId, selectedItems: ['arroz'] }))).status).toBe(
      401
    );
    expect(findMealPlanByIdForUserAndTenantMock).not.toHaveBeenCalled();
    findMealPlanByIdForUserAndTenantMock.mockResolvedValueOnce(null);
    const response = await POST(postRequest({ mealPlanId: planId, selectedItems: ['arroz'] }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Menú no encontrado.' });
    expect(listInventoryItemsByTenantMock).not.toHaveBeenCalled();
  });

  it('reports stale keys as ignored and supports already-present purchased rows', async () => {
    addMealPlanShoppingItemsMock.mockResolvedValueOnce({
      added: [],
      alreadyPresent: [{ id: 'existing', ingredient_name: 'Arroz', status: 'purchased' }],
    });
    const response = await POST(
      postRequest({ mealPlanId: planId, selectedItems: ['stale', 'arroz'] })
    );
    expect(await response.json()).toEqual({
      added: [],
      alreadyPresent: [{ id: 'existing', ingredient_name: 'Arroz', status: 'purchased' }],
      ignored: ['stale'],
    });
  });

  it('treats a consumed-meal ingredient as stale during confirmation recomputation', async () => {
    findMealPlanByIdForUserAndTenantMock.mockResolvedValue(
      persistedPlan({ consumption_payload: consumedBreakfastPayload() })
    );
    const response = await POST(postRequest({ mealPlanId: planId, selectedItems: ['arroz'] }));
    expect(response.status).toBe(200);
    expect(addMealPlanShoppingItemsMock).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ added: [], alreadyPresent: [], ignored: ['arroz'] });
  });
});
