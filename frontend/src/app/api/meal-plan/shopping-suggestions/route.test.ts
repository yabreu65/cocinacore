import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { UserMealPlanRow } from '@/lib/db/types';

const requireUserMock = vi.fn();
const findMealPlanByIdForUserAndTenantMock = vi.fn();
const listInventoryItemsByTenantMock = vi.fn();

vi.mock('@/lib/auth/server', () => ({ requireUser: requireUserMock }));
vi.mock('@/lib/db/repositories/mealPlanRepository', () => ({
  findMealPlanByIdForUserAndTenant: findMealPlanByIdForUserAndTenantMock,
}));
vi.mock('@/lib/db/repositories/inventoryRepository', () => ({
  listInventoryItemsByTenant: listInventoryItemsByTenantMock,
}));

const { GET } = await import('./route');

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
            ingredients: index === 0
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
            ingredients: [{ name: index === 0 ? 'Aceite' : `Almuerzo ${index}`, quantity: 1, unit: 'l' }],
          },
          {
            mealType: 'dinner',
            title: 'Cena',
            description: null,
            ingredients: [{ name: index === 0 ? 'Papa' : `Cena ${index}`, quantity: 1, unit: 'kg' }],
          },
        ],
      })),
    },
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
  return new Request(`https://app.example.test/api/meal-plan/shopping-suggestions?mealPlanId=${id}`) as unknown as NextRequest;
}

describe('GET /api/meal-plan/shopping-suggestions', () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    findMealPlanByIdForUserAndTenantMock.mockReset();
    listInventoryItemsByTenantMock.mockReset();
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
    const body = (await response.json()) as { items: Array<Record<string, unknown>> };
    expect(body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        normalizedName: 'arroz',
        status: 'buy',
        quantityToBuy: 1.5,
        unit: 'kg',
        usedInRecipes: expect.arrayContaining(['Lunes · Desayuno · Avena del día']),
      }),
      expect.objectContaining({ normalizedName: 'sal', status: 'review', quantityToBuy: null }),
    ]));
    expect(body.items.some((item) => item.normalizedName === 'harina' || item.normalizedName === 'aceite')).toBe(false);
    expect(body.items.every((item) => !('tenant_id' in item) && !('user_id' in item) && !('id' in item))).toBe(true);
    expect(JSON.stringify(body)).not.toContain('do-not-use-snapshot');
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
});
