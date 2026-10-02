import { describe, expect, it, vi } from 'vitest';
import type { RecipeInventoryItemRow, UserMealPlanRow } from '@/lib/db/types';
import { consumePlannedMealInTransaction } from './mealPlanConsumptionRepository';

const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

function plan(consumptionPayload: unknown = {}): UserMealPlanRow {
  return {
    id: PLAN_ID,
    tenant_id: TENANT_ID,
    user_id: USER_ID,
    people_count: 2,
    period: 'week',
    mode: 'balanced_ai',
    base_cuisine: 'E2E',
    fusion_cuisines: [],
    fusion_intensity: 'media',
    goal: null,
    restrictions: [],
    inventory_snapshot: {},
    calendar_payload: {
      period: 'week',
      dayCount: 7,
      days: Array.from({ length: 7 }, (_, index) => ({
        dayIndex: index + 1,
        label: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'][index],
        meals: [
          { mealType: 'breakfast', title: 'Desayuno', description: null, ingredients: index === 0 ? [{ name: 'Arroz', quantity: 1, unit: 'kg' }] : [{ name: 'Avena', quantity: 1, unit: 'taza' }] },
          { mealType: 'lunch', title: 'Almuerzo', description: null, ingredients: [{ name: 'Papa', quantity: 1, unit: 'kg' }] },
          { mealType: 'dinner', title: 'Cena', description: null, ingredients: [{ name: 'Sopa', quantity: 1, unit: 'l' }] },
        ],
      })),
    },
    consumption_payload: consumptionPayload,
    ai_content: null,
    created_at: '2026-09-30T00:00:00.000Z',
    updated_at: '2026-09-30T00:00:00.000Z',
  };
}

function inventory(quantity = '2', unit = 'kg'): RecipeInventoryItemRow {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    tenant_id: TENANT_ID,
    user_id: USER_ID,
    ingredient_name: 'Arroz',
    quantity,
    unit,
    category: 'Granos',
    expiration_date: null,
    estimated_unit_price: null,
    purchase_location: null,
    low_stock_threshold: null,
    normalized_name: 'arroz',
    notes: null,
    created_at: '2026-09-30T00:00:00.000Z',
    updated_at: '2026-09-30T00:00:00.000Z',
  };
}

describe('consumePlannedMeal', () => {
  it('decrements exact compatible stock and persists one audited consumption marker', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const row = inventory();
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        if (sql.includes('select * from public.user_meal_plans')) return { rows: [plan()] };
        if (sql.includes('select * from public.recipe_inventory_items')) return { rows: [row] };
        return { rows: [] };
      }),
    };
    const result = await consumePlannedMealInTransaction(client as never, {
      mealPlanId: PLAN_ID,
      tenantId: TENANT_ID,
      userId: USER_ID,
      dayIndex: 1,
      mealType: 'breakfast',
    });

    expect(result.alreadyConsumed).toBe(false);
    expect(result.record.decrements).toEqual([{ inventoryItemId: row.id, ingredientName: 'Arroz', quantity: 1, unit: 'kg' }]);
    expect(result.record.skipped).toEqual([]);
    expect(row.quantity).toBe('1');
    expect(queries.some((entry) => entry.sql.includes("'recipe_consumption'"))).toBe(true);
    expect(queries.at(-1)?.sql).toContain('set consumption_payload=$1::jsonb');
  });

  it('returns the persisted record without touching inventory on retry', async () => {
    const existing = {
      consumedAt: '2026-09-30T21:00:00.000Z',
      dayIndex: 1,
      mealType: 'breakfast' as const,
      mealTitle: 'Desayuno',
      decrements: [{ inventoryItemId: 'item-1', ingredientName: 'Arroz', quantity: 1, unit: 'kg' }],
      skipped: [],
    };
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('select * from public.user_meal_plans')) {
          return { rows: [plan({ '1:breakfast': existing })] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const result = await consumePlannedMealInTransaction(client as never, {
      mealPlanId: PLAN_ID,
      tenantId: TENANT_ID,
      userId: USER_ID,
      dayIndex: 1,
      mealType: 'breakfast',
    });

    expect(result).toEqual({ alreadyConsumed: true, record: existing });
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it('does not go negative and records the untracked shortfall', async () => {
    const row = inventory('250', 'g');
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('select * from public.user_meal_plans')) return { rows: [plan()] };
        if (sql.includes('select * from public.recipe_inventory_items')) return { rows: [row] };
        return { rows: [] };
      }),
    };
    const result = await consumePlannedMealInTransaction(client as never, {
      mealPlanId: PLAN_ID,
      tenantId: TENANT_ID,
      userId: USER_ID,
      dayIndex: 1,
      mealType: 'breakfast',
    });

    expect(row.quantity).toBe('0');
    expect(result.record.decrements[0]).toMatchObject({ quantity: 250, unit: 'g' });
    expect(result.record.skipped).toEqual([
      { ingredientName: 'Arroz', quantity: 0.75, unit: 'kg', reason: 'insufficient_tracked_quantity' },
    ]);
  });
});
