import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
const fixtureNow = new Date('2026-10-27T16:00:00.000Z');

afterEach(() => {
  vi.useRealTimers();
});

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
      schedule: {
        startDate: '2026-10-27',
        timeZone: 'America/Caracas',
        confirmedAt: '2026-10-27T12:00:00.000Z',
        portionConfirmation: {
          peopleCount: 50,
          confirmedAt: '2026-10-27T12:00:00.000Z',
        },
      },
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
    estimated_unit_price: null,
    purchase_location: null,
    low_stock_threshold: null,
    normalized_name: null,
    notes: null,
    expiration_date: '2026-11-20',
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
      consumedAt: '2026-10-27T14:00:00.000Z',
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
    vi.useFakeTimers({ now: fixtureNow });
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
    expect(listInventoryItemsByTenantMock).toHaveBeenCalledWith('tenant-1', 501);
    expect(listShoppingListItemsMock).toHaveBeenCalledWith('tenant-1', 'user-1', {}, 501);
    const body = (await response.json()) as { items: Array<Record<string, unknown>> };
    expect(body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedName: 'arroz',
          status: 'buy',
          quantityToBuy: 1.5,
          unit: 'kg',
          usedInRecipes: expect.arrayContaining<string>(['Avena del día · 2026-10-27']) as unknown,
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

  it('marks matching shopping rows from every source without exposing ownership data', async () => {
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

  it('fails closed without a confirmed schedule or portions', async () => {
    const currentPlan = persistedPlan();
    findMealPlanByIdForUserAndTenantMock.mockResolvedValue(
      persistedPlan({
        calendar_payload: {
          ...(currentPlan.calendar_payload as Record<string, unknown>),
          schedule: undefined,
        },
      })
    );
    const response = await GET(request() as unknown as NextRequest);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'unknown',
      reason: 'schedule_not_confirmed',
      items: [],
    });
  });

  it('classifies an insufficient horizon as unknown after the seven-day fixture ends', async () => {
    vi.setSystemTime(new Date('2026-10-28T16:00:00.000Z'));
    const response = await GET(request() as unknown as NextRequest);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'unknown',
      reason: 'plan_does_not_cover_horizon',
      items: [],
    });
  });
});

function postRequest(body: unknown): NextRequest {
  return new Request('https://app.example.test/api/meal-plan/shopping-suggestions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

async function confirmationBody(selectedItems: string[] = ['arroz']) {
  const response = await GET(request());
  const snapshot = (await response.json()) as {
    expectedUpdatedAt: string;
    sourceFingerprint: string;
  };
  return {
    mealPlanId: planId,
    horizonDays: 7,
    selectedItems,
    expectedUpdatedAt: snapshot.expectedUpdatedAt,
    expectedFingerprint: snapshot.sourceFingerprint,
  };
}

describe('POST /api/meal-plan/shopping-suggestions', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: fixtureNow });
    requireUserMock.mockReset();
    findMealPlanByIdForUserAndTenantMock.mockReset();
    listInventoryItemsByTenantMock.mockReset();
    addMealPlanShoppingItemsMock.mockReset();
    listShoppingListItemsMock.mockReset();
    listShoppingListItemsMock.mockResolvedValue([]);
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
    const response = await POST(postRequest(await confirmationBody(['arroz', 'sal', 'harina'])));
    expect(response.status).toBe(200);
    expect(listInventoryItemsByTenantMock).toHaveBeenCalledWith('tenant-1', 501);
    expect(addMealPlanShoppingItemsMock).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      userId: 'user-1',
      source: `meal-plan:${planId}`,
      dedupeScope: 'user',
      items: [{ ingredientName: 'Arroz', quantity: '1.5 kg' }],
    });
    expect(await response.json()).toEqual({
      added: [],
      alreadyPresent: [],
      ignored: ['sal', 'harina'],
    });
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
    const validBody = {
      mealPlanId: planId,
      horizonDays: 7,
      selectedItems: ['arroz'],
      expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
      expectedFingerprint: 'a'.repeat(64),
    };
    requireUserMock.mockRejectedValueOnce(new Error('Unauthorized'));
    expect((await POST(postRequest(validBody))).status).toBe(401);
    expect(findMealPlanByIdForUserAndTenantMock).not.toHaveBeenCalled();
    findMealPlanByIdForUserAndTenantMock.mockResolvedValueOnce(null);
    const response = await POST(postRequest(validBody));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Menú no encontrado.' });
    expect(listInventoryItemsByTenantMock).not.toHaveBeenCalled();
  });

  it('reports stale keys as ignored and supports already-present purchased rows', async () => {
    addMealPlanShoppingItemsMock.mockResolvedValueOnce({
      added: [],
      alreadyPresent: [{ id: 'existing', ingredient_name: 'Arroz', status: 'purchased' }],
    });
    const response = await POST(postRequest(await confirmationBody(['stale', 'arroz'])));
    expect(await response.json()).toEqual({
      added: [],
      alreadyPresent: [{ id: 'existing', ingredient_name: 'Arroz', status: 'purchased' }],
      ignored: ['stale'],
    });
  });

  it('rejects a stale proposal before any shopping write', async () => {
    const body = await confirmationBody();
    const response = await POST(
      postRequest({ ...body, expectedFingerprint: 'b'.repeat(body.expectedFingerprint.length) })
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'La propuesta está desactualizada. Prepará una nueva propuesta.',
    });
    expect(addMealPlanShoppingItemsMock).not.toHaveBeenCalled();
  });

  it('treats a consumed-meal ingredient as stale during confirmation recomputation', async () => {
    findMealPlanByIdForUserAndTenantMock.mockResolvedValue(
      persistedPlan({ consumption_payload: consumedBreakfastPayload() })
    );
    const response = await POST(postRequest(await confirmationBody()));
    expect(response.status).toBe(200);
    expect(addMealPlanShoppingItemsMock).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ added: [], alreadyPresent: [], ignored: ['arroz'] });
  });
});
