import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { RecipeInventoryItemRow, UserMealPlanRow } from '@/lib/db/types';

const mockRequireUser = vi.fn();
const mockFindLatestMealPlanByUserAndTenant = vi.fn();
const mockListInventoryItemsByTenant = vi.fn();

vi.mock('@/lib/auth/server', () => ({ requireUser: mockRequireUser }));
vi.mock('@/lib/db/repositories/mealPlanRepository', () => ({
  findLatestMealPlanByUserAndTenant: mockFindLatestMealPlanByUserAndTenant,
}));
vi.mock('@/lib/db/repositories/inventoryRepository', () => ({
  listInventoryItemsByTenant: mockListInventoryItemsByTenant,
}));
vi.mock('@/lib/serverLogger', () => ({ serverLogger: { info: vi.fn(), warn: vi.fn() } }));

const { GET } = await import('./route');

function request(horizonDays = '7'): NextRequest {
  return new Request(
    `https://app.example.test/api/meal-plan/coverage?horizonDays=${encodeURIComponent(horizonDays)}`
  ) as unknown as NextRequest;
}

function planRow(overrides: Partial<UserMealPlanRow> = {}): UserMealPlanRow {
  return {
    id: 'plan-1',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    people_count: 2,
    period: 'fortnight',
    mode: 'balanced_ai',
    base_cuisine: 'Latinoamericana',
    fusion_cuisines: [],
    fusion_intensity: 'media',
    goal: null,
    restrictions: [],
    inventory_snapshot: {},
    calendar_payload: {
      period: 'fortnight',
      dayCount: 14,
      days: Array.from({ length: 14 }, (_, index) => ({
        dayIndex: index + 1,
        meals: ['breakfast', 'lunch', 'dinner'].map((mealType) => ({
          mealType,
          title: `Comida ${index + 1}`,
          prepMinutes: 20,
          description: null,
          ingredients: [
            { name: 'Arroz', quantity: index < 2 ? 500 : 0, unit: 'g' },
          ],
        })),
      })),
      schedule: {
        startDate: '2026-10-25',
        timeZone: 'UTC',
        confirmedAt: '2026-10-24T12:00:00.000Z',
        portionConfirmation: {
          peopleCount: 2,
          confirmedAt: '2026-10-24T12:00:00.000Z',
        },
      },
    },
    consumption_payload: {},
    ai_content: null,
    created_at: '2026-10-24T12:00:00.000Z',
    updated_at: '2026-10-24T12:00:00.000Z',
    ...overrides,
  };
}

function inventoryItem(overrides: Partial<RecipeInventoryItemRow> = {}): RecipeInventoryItemRow {
  return {
    id: 'inventory-1',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    ingredient_name: 'Arroz',
    quantity: '750 g',
    unit: null,
    category: null,
    expiration_date: '2026-11-07',
    estimated_unit_price: null,
    purchase_location: null,
    low_stock_threshold: null,
    normalized_name: 'arroz',
    notes: null,
    created_at: '2026-10-20T00:00:00.000Z',
    updated_at: '2026-10-20T00:00:00.000Z',
    ...overrides,
  };
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

describe('GET /api/meal-plan/coverage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T12:00:00.000Z'));
    mockRequireUser.mockReset().mockResolvedValue(user);
    mockFindLatestMealPlanByUserAndTenant.mockReset().mockResolvedValue(planRow());
    mockListInventoryItemsByTenant.mockReset().mockResolvedValue([inventoryItem()]);
  });

  afterEach(() => vi.useRealTimers());

  it('requires authentication and never queries plans or inventory for anonymous requests', async () => {
    mockRequireUser.mockRejectedValue(new Error('unauthorized'));

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mockFindLatestMealPlanByUserAndTenant).not.toHaveBeenCalled();
    expect(mockListInventoryItemsByTenant).not.toHaveBeenCalled();
  });

  it('accepts only the 7- or 14-day horizon before querying tenant data', async () => {
    const response = await GET(request('8'));

    expect(response.status).toBe(400);
    expect(mockFindLatestMealPlanByUserAndTenant).not.toHaveBeenCalled();
    expect(mockListInventoryItemsByTenant).not.toHaveBeenCalled();
  });

  it('returns unknown before inventory reads when saved plan portions are not confirmed', async () => {
    const savedPlan = planRow();
    mockFindLatestMealPlanByUserAndTenant.mockResolvedValue(
      planRow({
        calendar_payload: {
          ...(savedPlan.calendar_payload as Record<string, unknown>),
          schedule: {
            startDate: '2026-10-25',
            timeZone: 'UTC',
            confirmedAt: '2026-10-24T12:00:00.000Z',
          },
        },
      })
    );
    mockListInventoryItemsByTenant.mockResolvedValue([inventoryItem({ quantity: '100 kg' })]);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      forecast: { status: 'unknown', reason: 'portion_basis_not_confirmed', items: [] },
    });
    expect(mockListInventoryItemsByTenant).not.toHaveBeenCalled();
  });

  it('rejects portion confirmation when the saved people count has changed', async () => {
    const savedPlan = planRow();
    mockFindLatestMealPlanByUserAndTenant.mockResolvedValue(
      planRow({
        people_count: 4,
        calendar_payload: {
          ...(savedPlan.calendar_payload as Record<string, unknown>),
          schedule: {
            startDate: '2026-10-25',
            timeZone: 'UTC',
            confirmedAt: '2026-10-24T12:00:00.000Z',
            portionConfirmation: {
              peopleCount: 2,
              confirmedAt: '2026-10-24T12:00:00.000Z',
            },
          },
        },
      })
    );
    mockListInventoryItemsByTenant.mockResolvedValue([inventoryItem({ quantity: '100 kg' })]);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      peopleCount: 4,
      forecast: { status: 'unknown', reason: 'portion_basis_not_confirmed', items: [] },
    });
    expect(mockListInventoryItemsByTenant).not.toHaveBeenCalled();
  });

  it('scopes the saved plan and inventory reads to the authenticated user and tenant', async () => {
    const response = await GET(request('7'));

    expect(response.status).toBe(200);
    expect(mockFindLatestMealPlanByUserAndTenant).toHaveBeenCalledWith('user-1', 'tenant-1');
    expect(mockListInventoryItemsByTenant).toHaveBeenCalledWith('tenant-1');
    expect(await response.json()).toMatchObject({
      mealPlanId: 'plan-1',
      peopleCount: 2,
      forecast: {
        status: 'ready',
        horizonDays: 7,
        timeZone: 'UTC',
        items: [{ normalizedName: 'arroz', status: 'partial', requiredTotalQuantity: 3000 }],
      },
    });
  });

  it('forwards expiration dates and excludes stock that expires before the horizon ends', async () => {
    mockListInventoryItemsByTenant.mockResolvedValue([
      inventoryItem({ expiration_date: '2026-10-30', quantity: '100 kg' }),
      inventoryItem({ id: 'valid-lot', expiration_date: '2026-10-31', quantity: '750 g' }),
    ]);

    const response = await GET(request('7'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      forecast: {
        status: 'ready',
        items: [{ availableQuantity: 750, status: 'partial', missingQuantity: 2250 }],
      },
    });
  });

  it('keeps coverage unknown when inventory freshness is absent or invalid', async () => {
    mockListInventoryItemsByTenant.mockResolvedValue([
      inventoryItem({ expiration_date: null, quantity: '100 kg' }),
      inventoryItem({ id: 'invalid-date', expiration_date: 'not-a-date', quantity: '100 kg' }),
    ]);

    const response = await GET(request('7'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      forecast: {
        status: 'ready',
        items: [{ status: 'unknown', availableQuantity: null, missingQuantity: null }],
      },
    });
  });

  it('returns unknown for legacy or unscheduled plans without inferring dates from creation metadata', async () => {
    mockFindLatestMealPlanByUserAndTenant.mockResolvedValue(
      planRow({
        calendar_payload: {
          period: 'fortnight',
          dayCount: 14,
          days: planRow().calendar_payload && (planRow().calendar_payload as { days: unknown[] }).days,
        },
        created_at: '2026-10-25T00:00:00.000Z',
      })
    );

    const response = await GET(request('14'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      mealPlanId: 'plan-1',
      forecast: { status: 'unknown', reason: 'schedule_not_confirmed', items: [] },
    });
    expect(mockListInventoryItemsByTenant).not.toHaveBeenCalled();
  });

  it('rejects a saved plan returned for a different tenant before reading inventory', async () => {
    mockFindLatestMealPlanByUserAndTenant.mockResolvedValue(planRow({ tenant_id: 'tenant-2' }));

    const response = await GET(request());

    expect(response.status).toBe(404);
    expect(mockListInventoryItemsByTenant).not.toHaveBeenCalled();
  });

  it('returns an explicit unknown result when no persisted plan exists', async () => {
    mockFindLatestMealPlanByUserAndTenant.mockResolvedValue(null);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      mealPlanId: null,
      forecast: { status: 'unknown', reason: 'no_saved_plan', items: [] },
    });
    expect(mockListInventoryItemsByTenant).not.toHaveBeenCalled();
  });

  it('returns a server error and does not read inventory when plan lookup fails', async () => {
    mockFindLatestMealPlanByUserAndTenant.mockRejectedValue(new Error('database unavailable'));

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'No se pudo recuperar el menú guardado.' });
    expect(mockListInventoryItemsByTenant).not.toHaveBeenCalled();
  });

  it('rejects a malformed persisted plan before reading inventory', async () => {
    mockFindLatestMealPlanByUserAndTenant.mockResolvedValue(
      planRow({
        calendar_payload: { period: 'fortnight', dayCount: 14, days: [] },
      })
    );

    const response = await GET(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'El menú guardado no tiene un formato válido.' });
    expect(mockListInventoryItemsByTenant).not.toHaveBeenCalled();
  });

  it('excludes confirmed consumption and ignores inventory returned for another tenant', async () => {
    mockFindLatestMealPlanByUserAndTenant.mockResolvedValue(
      planRow({
        consumption_payload: {
          '1:lunch': {
            consumedAt: '2026-10-25T11:00:00.000Z',
            dayIndex: 1,
            mealType: 'lunch',
            mealTitle: 'Comida 1',
            decrements: [],
            skipped: [],
          },
        },
      })
    );
    mockListInventoryItemsByTenant.mockResolvedValue([
      inventoryItem({ tenant_id: 'tenant-1', quantity: '1 kg' }),
      inventoryItem({ id: 'foreign-item', tenant_id: 'tenant-2', quantity: '100 kg' }),
    ]);

    const response = await GET(request('7'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      forecast: {
        status: 'ready',
        consumedMealCount: 1,
        items: [{ requiredTotalQuantity: 2500, availableQuantity: 1000, status: 'partial' }],
      },
    });
  });
});
