import { describe, expect, it } from 'vitest';
import type { QueryResultRow } from 'pg';
import type { RecipeInventoryItemRow, UserMealPlanRow } from '@/lib/db/types';
import type { DbTransactionClient } from '@/lib/db/transaction-client';
import {
  consumePlannedMealInTransaction,
  MealPlanConsumptionError,
} from './mealPlanConsumptionRepository';

const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

function mockClient(handler: (sql: string, params?: unknown[]) => QueryResultRow[]): {
  client: DbTransactionClient;
  queries: Array<{ sql: string; params?: unknown[] }>;
} {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const query: DbTransactionClient['query'] = async <Row extends QueryResultRow>(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: Row[] }> => {
    queries.push({ sql, params });
    return { rows: handler(sql, params) as Row[] };
  };
  return { client: { query }, queries };
}

function plan(
  consumptionPayload: unknown = {},
  firstIngredient = { name: 'Arroz', quantity: 1, unit: 'kg' }
): UserMealPlanRow {
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
          {
            mealType: 'breakfast',
            title: 'Desayuno',
            description: null,
            ingredients:
              index === 0 ? [firstIngredient] : [{ name: 'Avena', quantity: 1, unit: 'taza' }],
          },
          {
            mealType: 'lunch',
            title: 'Almuerzo',
            description: null,
            ingredients: [{ name: 'Papa', quantity: 1, unit: 'kg' }],
          },
          {
            mealType: 'dinner',
            title: 'Cena',
            description: null,
            ingredients: [{ name: 'Sopa', quantity: 1, unit: 'l' }],
          },
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
    const row = inventory();
    const { client, queries } = mockClient((sql) => {
      if (sql.includes('select * from public.user_meal_plans')) return [plan()];
      if (sql.includes('select * from public.recipe_inventory_items')) return [row];
      if (sql.includes('update public.recipe_inventory_items')) return [{ id: row.id }];
      if (sql.includes('update public.user_meal_plans')) return [{ id: PLAN_ID }];
      return [];
    });
    const result = await consumePlannedMealInTransaction(client, {
      mealPlanId: PLAN_ID,
      tenantId: TENANT_ID,
      userId: USER_ID,
      dayIndex: 1,
      mealType: 'breakfast',
    });

    expect(result.alreadyConsumed).toBe(false);
    expect(result.record.decrements).toEqual([
      { inventoryItemId: row.id, ingredientName: 'Arroz', quantity: 1, unit: 'kg' },
    ]);
    expect(result.record.skipped).toEqual([]);
    expect(row.quantity).toBe('1');
    expect(queries.some((entry) => entry.sql.includes("'recipe_consumption'"))).toBe(true);
    expect(
      queries.find((entry) => entry.sql.includes('from public.recipe_inventory_items'))?.params
    ).toEqual([TENANT_ID, USER_ID]);
    expect(
      queries.find((entry) => entry.sql.includes('update public.recipe_inventory_items'))?.params
    ).toEqual(['1', row.id, TENANT_ID, USER_ID]);
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
    const { client, queries } = mockClient((sql) => {
      if (sql.includes('select * from public.user_meal_plans')) {
        return [plan({ '1:breakfast': existing })];
      }
      if (sql.includes('pg_advisory_xact_lock')) return [];
      throw new Error(`unexpected query: ${sql}`);
    });
    const result = await consumePlannedMealInTransaction(client, {
      mealPlanId: PLAN_ID,
      tenantId: TENANT_ID,
      userId: USER_ID,
      dayIndex: 1,
      mealType: 'breakfast',
    });

    expect(result).toEqual({ alreadyConsumed: true, record: existing });
    expect(queries).toHaveLength(2);
    expect(queries[0].params).toEqual(['cocinacore:inventory-source:v1:' + TENANT_ID]);
  });

  it('does not go negative and records the untracked shortfall', async () => {
    const row = inventory('250', 'g');
    const { client } = mockClient((sql) => {
      if (sql.includes('select * from public.user_meal_plans')) return [plan()];
      if (sql.includes('select * from public.recipe_inventory_items')) return [row];
      if (sql.includes('update public.recipe_inventory_items')) return [{ id: row.id }];
      if (sql.includes('update public.user_meal_plans')) return [{ id: PLAN_ID }];
      return [];
    });
    const result = await consumePlannedMealInTransaction(client, {
      mealPlanId: PLAN_ID,
      tenantId: TENANT_ID,
      userId: USER_ID,
      dayIndex: 1,
      mealType: 'breakfast',
    });

    expect(row.quantity).toBe('0');
    expect(result.record.decrements[0]).toMatchObject({ quantity: 250, unit: 'g' });
    expect(result.record.skipped).toEqual([
      {
        ingredientName: 'Arroz',
        quantity: 0.75,
        unit: 'kg',
        reason: 'insufficient_tracked_quantity',
      },
    ]);
  });

  it('does not let legacy consumption bypass a real reconciliation claim', async () => {
    const { client, queries } = mockClient((sql) => {
      if (sql.includes('select * from public.user_meal_plans')) return [plan()];
      if (sql.includes('select mode from public.meal_consumption_claims')) {
        return [{ mode: 'real_reconciliation' }];
      }
      return [];
    });

    await expect(
      consumePlannedMealInTransaction(client, {
        mealPlanId: PLAN_ID,
        tenantId: TENANT_ID,
        userId: USER_ID,
        dayIndex: 1,
        mealType: 'breakfast',
      })
    ).rejects.toMatchObject({
      constructor: MealPlanConsumptionError,
      code: 'already_claimed',
    });
    expect(
      queries.some((entry) => entry.sql.includes('select * from public.recipe_inventory_items'))
    ).toBe(false);
  });
  it.each([
    ['1/3', 'kg'],
    ['2 g', 'kg'],
    ['2', ''],
    ['0.00001', 'kg'],
    ['999999999', 'kg'],
    ['2 kg basura', 'kg'],
  ])('does not deduct ambiguous or unrepresentable stock %s %s', async (quantity, unit) => {
    const row = inventory(quantity, unit);
    const { client, queries } = mockClient((sql) => {
      if (sql.includes('select * from public.user_meal_plans')) return [plan()];
      if (sql.includes('select * from public.recipe_inventory_items')) return [row];
      if (sql.includes('update public.user_meal_plans')) return [{ id: PLAN_ID }];
      return [];
    });
    const result = await consumePlannedMealInTransaction(client, {
      mealPlanId: PLAN_ID,
      tenantId: TENANT_ID,
      userId: USER_ID,
      dayIndex: 1,
      mealType: 'breakfast',
    });
    expect(result.record.decrements).toEqual([]);
    expect(result.record.skipped).toHaveLength(1);
    expect(row.quantity).toBe(quantity);
    expect(
      queries.some(
        (q) =>
          q.sql.includes('update public.recipe_inventory_items') ||
          q.sql.includes('insert into public.inventory_movements')
      )
    ).toBe(false);
    expect(queries[0].params).toEqual(['cocinacore:inventory-source:v1:' + TENANT_ID]);
  });
  it('rejects malformed consumption evidence without overwriting it', async () => {
    const { client, queries } = mockClient((sql) =>
      sql.includes('select * from public.user_meal_plans')
        ? [plan({ '1:lunch': { broken: true } })]
        : []
    );
    await expect(
      consumePlannedMealInTransaction(client, {
        mealPlanId: PLAN_ID,
        tenantId: TENANT_ID,
        userId: USER_ID,
        dayIndex: 1,
        mealType: 'breakfast',
      })
    ).rejects.toMatchObject({ code: 'invalid_plan' });
    expect(queries).toHaveLength(2);
  });
  it('stops before audit if the locked stock update affects no row', async () => {
    const row = inventory();
    const { client, queries } = mockClient((sql) =>
      sql.includes('select * from public.user_meal_plans')
        ? [plan()]
        : sql.includes('select * from public.recipe_inventory_items')
          ? [row]
          : []
    );
    await expect(
      consumePlannedMealInTransaction(client, {
        mealPlanId: PLAN_ID,
        tenantId: TENANT_ID,
        userId: USER_ID,
        dayIndex: 1,
        mealType: 'breakfast',
      })
    ).rejects.toThrow('Locked inventory update failed');
    expect(queries.some((q) => q.sql.includes('insert into public.inventory_movements'))).toBe(
      false
    );
  });
  it.each([
    ['2000-01-01', 'expired_inventory'],
    ['bad-date', 'invalid_expiration_date'],
  ])('preserves stock with expiry %s', async (expiration_date, reason) => {
    const row = { ...inventory(), expiration_date };
    const { client, queries } = mockClient((sql) =>
      sql.includes('select * from public.user_meal_plans')
        ? [plan()]
        : sql.includes('select * from public.recipe_inventory_items')
          ? [row]
          : sql.includes('update public.user_meal_plans')
            ? [{ id: PLAN_ID }]
            : []
    );
    const result = await consumePlannedMealInTransaction(client, {
      mealPlanId: PLAN_ID,
      tenantId: TENANT_ID,
      userId: USER_ID,
      dayIndex: 1,
      mealType: 'breakfast',
    });
    expect(result.record.skipped[0].reason).toBe(reason);
    expect(queries.some((q) => q.sql.includes('update public.recipe_inventory_items'))).toBe(false);
  });
  it('deducts three teaspoons for a tablespoon in planned consumption', async () => {
    const row = inventory('4', 'cucharadita');
    const { client, queries } = mockClient((sql) =>
      sql.includes('select * from public.user_meal_plans')
        ? [plan({}, { name: 'Arroz', quantity: 1, unit: 'cucharada' })]
        : sql.includes('select * from public.recipe_inventory_items')
          ? [row]
          : sql.includes('update public.recipe_inventory_items')
            ? [{ id: row.id }]
            : sql.includes('update public.user_meal_plans')
              ? [{ id: PLAN_ID }]
              : []
    );
    const result = await consumePlannedMealInTransaction(client, {
      mealPlanId: PLAN_ID,
      tenantId: TENANT_ID,
      userId: USER_ID,
      dayIndex: 1,
      mealType: 'breakfast',
    });
    expect(row.quantity).toBe('1');
    expect(result.record.decrements).toEqual([
      { inventoryItemId: row.id, ingredientName: 'Arroz', quantity: 3, unit: 'cucharadita' },
    ]);
    expect(
      queries.find((q) => q.sql.includes('insert into public.inventory_movements'))?.params?.[3]
    ).toBe(3);
  });
  it('does not round one third of a tablespoon when a teaspoon is requested', async () => {
    const row = inventory('1', 'cucharada');
    const { client, queries } = mockClient((sql) =>
      sql.includes('select * from public.user_meal_plans')
        ? [plan({}, { name: 'Arroz', quantity: 1, unit: 'cucharadita' })]
        : sql.includes('select * from public.recipe_inventory_items')
          ? [row]
          : sql.includes('update public.user_meal_plans')
            ? [{ id: PLAN_ID }]
            : []
    );
    const result = await consumePlannedMealInTransaction(client, {
      mealPlanId: PLAN_ID,
      tenantId: TENANT_ID,
      userId: USER_ID,
      dayIndex: 1,
      mealType: 'breakfast',
    });
    expect(row.quantity).toBe('1');
    expect(result.record.skipped[0].reason).toBe('unrepresentable_inventory_quantity');
    expect(
      queries.some(
        (q) =>
          q.sql.includes('update public.recipe_inventory_items') ||
          q.sql.includes('insert into public.inventory_movements')
      )
    ).toBe(false);
  });
});
