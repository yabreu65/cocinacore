import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { UserMealPlanRow, ShoppingListItemRow } from '@/lib/db/types';

const requireUserMock = vi.fn();
const findMealPlanByIdForUserAndTenantMock = vi.fn();
const listInventoryItemsByTenantMock = vi.fn();
const addMealPlanShoppingItemsMock = vi.fn();
const listShoppingListItemsMock = vi.fn();

const tenantId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const lockMock = vi.fn();
const calls: Array<{ sql: string; params: unknown[]; client: unknown }> = [];
const clients: unknown[] = [];
const insertedRows: ShoppingListItemRow[] = [];
let serializeTransactions = false;
let transactionTail = Promise.resolve();

const scopedMock = vi.fn(
  async (
    _scope: unknown,
    callback: (client: {
      query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
    }) => Promise<unknown>,
    options: unknown
  ) => {
    expect(options).toEqual({ isolationLevel: 'read committed' });
    let release: (() => void) | undefined;
    const client = {
      query: async (sql: string, params: unknown[] = []): Promise<{ rows: unknown[] }> => {
        calls.push({ sql, params, client });
        if (sql.includes('pg_advisory_xact_lock')) {
          if (
            serializeTransactions &&
            !release &&
            String(params[0]).startsWith('cocinacore:inventory-source:v1:')
          ) {
            const previous = transactionTail;
            transactionTail = new Promise<void>((resolve) => {
              release = resolve;
            });
            await previous;
          }
          await lockMock();
          return { rows: [] };
        }
        if (sql.includes('from public.user_meal_plans')) {
          const plan: unknown = await findMealPlanByIdForUserAndTenantMock(...params);
          return { rows: plan ? [plan] : [] };
        }
        if (sql.includes('from public.recipe_inventory_items'))
          return { rows: (await listInventoryItemsByTenantMock(...params)) as unknown[] };
        if (sql.includes('from public.shopping_list_items'))
          return { rows: (await listShoppingListItemsMock(...params)) as unknown[] };
        if (sql.includes('insert into public.shopping_list_items')) {
          const row: ShoppingListItemRow = {
            id: `inserted-${insertedRows.length + 1}`,
            tenant_id: String(params[0]),
            user_id: String(params[1]),
            source: String(params[2]),
            ingredient_name: String(params[3]),
            quantity: params[4] === null ? null : String(params[4]),
            status: 'pending',
            premium_recipe_id: null,
            transfer_inventory_item_id: null,
            transferred_at: null,
            created_at: '2026-10-27T16:00:00Z',
            updated_at: '2026-10-27T16:00:00Z',
          };
          insertedRows.push(row);
          return { rows: [row] };
        }
        throw new Error('Unexpected query: ' + sql);
      },
    };
    clients.push(client);
    try {
      return await callback(client);
    } finally {
      release?.();
    }
  }
);
vi.mock('@/lib/auth/server', () => ({ requireUser: requireUserMock }));
vi.mock('@/lib/db', () => ({
  scopedTransaction: scopedMock,
  query: vi.fn(),
  mapSingleRow: vi.fn(),
}));
vi.mock('@/lib/db/repositories/shoppingListRepository', () => ({
  addMealPlanShoppingItemsInTransaction: addMealPlanShoppingItemsMock,
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
    tenant_id: tenantId,
    user_id: userId,
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
    tenant_id: tenantId,
    user_id: userId,
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
    calls.length = 0;
    clients.length = 0;
    insertedRows.length = 0;
    serializeTransactions = false;
    transactionTail = Promise.resolve();
    scopedMock.mockClear();
    lockMock.mockReset();
    lockMock.mockResolvedValue(undefined);
    requireUserMock.mockReset();
    findMealPlanByIdForUserAndTenantMock.mockReset();
    listInventoryItemsByTenantMock.mockReset();
    addMealPlanShoppingItemsMock.mockReset();
    listShoppingListItemsMock.mockReset();
    listShoppingListItemsMock.mockResolvedValue([]);
    addMealPlanShoppingItemsMock.mockResolvedValue({ added: [], alreadyPresent: [] });
    requireUserMock.mockResolvedValue({ id: userId, tenant: { tenantId: tenantId } });
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
    expect(findMealPlanByIdForUserAndTenantMock).toHaveBeenCalledWith(planId, tenantId, userId);
    expect(listInventoryItemsByTenantMock).toHaveBeenCalledWith(tenantId, 501);
    expect(listShoppingListItemsMock).toHaveBeenCalledWith(tenantId, userId, 501);
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
        tenant_id: tenantId,
        user_id: userId,
        source: `meal-plan:${planId}`,
        ingredient_name: ' ARROZ ',
        status: 'pending',
      },
      {
        id: 'purchased-row',
        tenant_id: tenantId,
        user_id: userId,
        source: `meal-plan:${planId}`,
        ingredient_name: 'Sal',
        status: 'purchased',
      },
      {
        id: 'manual-row',
        tenant_id: tenantId,
        user_id: userId,
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
    calls.length = 0;
    clients.length = 0;
    insertedRows.length = 0;
    serializeTransactions = false;
    transactionTail = Promise.resolve();
    scopedMock.mockClear();
    lockMock.mockReset();
    lockMock.mockResolvedValue(undefined);
    requireUserMock.mockReset();
    findMealPlanByIdForUserAndTenantMock.mockReset();
    listInventoryItemsByTenantMock.mockReset();
    addMealPlanShoppingItemsMock.mockReset();
    listShoppingListItemsMock.mockReset();
    listShoppingListItemsMock.mockResolvedValue([]);
    requireUserMock.mockResolvedValue({ id: userId, tenant: { tenantId: tenantId } });
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
    expect(findMealPlanByIdForUserAndTenantMock).toHaveBeenLastCalledWith(planId, tenantId, userId);
    expect(listShoppingListItemsMock).toHaveBeenLastCalledWith(tenantId, userId, 501);
    expect(listInventoryItemsByTenantMock).toHaveBeenCalledWith(tenantId, 501);
    expect(addMealPlanShoppingItemsMock).toHaveBeenCalledWith(clients.at(-1), {
      tenantId: tenantId,
      userId: userId,
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
  it('uses one authenticated READ COMMITTED transaction and acquires tenant lock before all POST reads and writes', async () => {
    const body = await confirmationBody();
    calls.length = 0;
    clients.length = 0;
    scopedMock.mockClear();
    expect((await POST(postRequest(body))).status).toBe(200);
    expect(scopedMock).toHaveBeenCalledTimes(1);
    expect(scopedMock).toHaveBeenCalledWith({ tenantId, userId }, expect.any(Function), {
      isolationLevel: 'read committed',
    });
    expect(
      calls.map((c) =>
        c.sql.includes('pg_advisory') ? 'lock' : c.sql.match(/from public\.(\w+)/)?.[1]
      )
    ).toEqual(['lock', 'user_meal_plans', 'recipe_inventory_items', 'shopping_list_items']);
    expect(calls.every((c) => c.client === clients[0])).toBe(true);
    expect(calls[0].params).toEqual([`cocinacore:inventory-source:v1:${tenantId}`]);
    expect(addMealPlanShoppingItemsMock).toHaveBeenCalledWith(
      clients[0],
      expect.objectContaining({ tenantId, userId })
    );
  });
  it.each(['inventory', 'shopping', 'plan', 'consumption', 'date'] as const)(
    'rejects source %s changed while waiting for the lock',
    async (source) => {
      const body = await confirmationBody();
      lockMock.mockImplementationOnce(() => {
        if (source === 'inventory')
          listInventoryItemsByTenantMock.mockResolvedValue([inventoryItem('Arroz', '2', 'kg')]);
        if (source === 'shopping')
          listShoppingListItemsMock.mockResolvedValue([
            {
              id: 'new-row',
              tenant_id: tenantId,
              user_id: userId,
              source: 'manual',
              ingredient_name: 'Arroz',
              status: 'pending',
            },
          ]);
        if (source === 'plan')
          findMealPlanByIdForUserAndTenantMock.mockResolvedValue(
            persistedPlan({ updated_at: '2026-01-01T00:00:00.000001Z' })
          );
        if (source === 'consumption')
          findMealPlanByIdForUserAndTenantMock.mockResolvedValue(
            persistedPlan({ consumption_payload: consumedBreakfastPayload() })
          );
        if (source === 'date') vi.setSystemTime(new Date('2026-10-28T16:00:00Z'));
      });
      expect((await POST(postRequest(body))).status).toBe(409);
      expect(addMealPlanShoppingItemsMock).not.toHaveBeenCalled();
    }
  );
  it.each(['inventory', 'shopping'] as const)(
    'rejects the 501-row %s sentinel without writes',
    async (source) => {
      const body = await confirmationBody();
      if (source === 'inventory')
        listInventoryItemsByTenantMock.mockResolvedValue(
          Array(501).fill(inventoryItem('Arroz', '1', 'kg'))
        );
      else listShoppingListItemsMock.mockResolvedValue(Array(501).fill({ id: 'row' }));
      expect((await POST(postRequest(body))).status).toBe(409);
      expect(addMealPlanShoppingItemsMock).not.toHaveBeenCalled();
    }
  );
  it('does not read or write if tenant lock acquisition fails', async () => {
    const body = await confirmationBody();
    calls.length = 0;
    lockMock.mockRejectedValueOnce(new Error('lock failed'));
    expect((await POST(postRequest(body))).status).toBe(500);
    expect(calls).toHaveLength(1);
    expect(addMealPlanShoppingItemsMock).not.toHaveBeenCalled();
  });
  it('accepts equivalent exact timestamp representations but rejects lost microseconds', async () => {
    findMealPlanByIdForUserAndTenantMock.mockResolvedValue(
      persistedPlan({ updated_at: '2026-01-01 00:00:00.123456+00' })
    );
    const body = await confirmationBody();
    expect(
      (await POST(postRequest({ ...body, expectedUpdatedAt: '2026-01-01T00:00:00.123456Z' })))
        .status
    ).toBe(200);
    addMealPlanShoppingItemsMock.mockClear();
    expect(
      (await POST(postRequest({ ...body, expectedUpdatedAt: '2026-01-01T00:00:00.123Z' }))).status
    ).toBe(409);
    expect(addMealPlanShoppingItemsMock).not.toHaveBeenCalled();
  });
  it('serializes concurrent confirmations with the actual same-client writer: first inserts, second sees a stale fingerprint', async () => {
    const actual = await vi.importActual<
      typeof import('@/lib/db/repositories/shoppingListRepository')
    >('@/lib/db/repositories/shoppingListRepository');
    addMealPlanShoppingItemsMock.mockImplementation(actual.addMealPlanShoppingItemsInTransaction);
    listShoppingListItemsMock.mockImplementation(() => Promise.resolve([...insertedRows]));
    const body = await confirmationBody();
    calls.length = 0;
    clients.length = 0;
    scopedMock.mockClear();
    serializeTransactions = true;
    const results = await Promise.all([POST(postRequest(body)), POST(postRequest(body))]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({
      ingredient_name: 'Arroz',
      quantity: '1.5 kg',
      tenant_id: tenantId,
      user_id: userId,
    });
    expect(scopedMock).toHaveBeenCalledTimes(2);
    expect(addMealPlanShoppingItemsMock).toHaveBeenCalledOnce();
    const write = calls.find((c) => c.sql.includes('insert into public.shopping_list_items'));
    const reads = calls.filter((c) => c.sql.includes('from public.user_meal_plans'));
    expect(write?.client).toBe(reads[0].client);
    expect(calls.indexOf(write!)).toBeLessThan(calls.indexOf(reads[1]));
  });
});
