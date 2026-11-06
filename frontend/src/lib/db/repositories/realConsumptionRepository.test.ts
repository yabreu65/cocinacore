import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueryResultRow } from 'pg';
import type { CookingSessionRow, RecipeInventoryItemRow } from '@/lib/db/types';
import type { DbTransactionClient } from '@/lib/db/transaction-client';

const mocks = vi.hoisted(() => ({ revalidate: vi.fn() }));
vi.mock('@/lib/db/repositories/cookingSessionRepository', () => ({
  revalidateCookingSessionSourceInTransaction: mocks.revalidate,
}));

import {
  claimPlannedMealInTransaction,
  reconcileRealConsumptionInTransaction,
} from './realConsumptionRepository';

const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';
const PLAN_ID = '55555555-5555-4555-8555-555555555555';
const RECIPE_ID = '66666666-6666-4666-8666-666666666666';
const VERSION_ID = '77777777-7777-4777-8777-777777777777';
const INVENTORY_ID = '88888888-8888-4888-8888-888888888888';

function createQueryClient(handler: (sql: string, params?: unknown[]) => QueryResultRow[]): {
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

function session(): CookingSessionRow {
  return {
    id: SESSION_ID,
    tenant_id: TENANT_ID,
    user_id: USER_ID,
    meal_plan_id: PLAN_ID,
    day_index: 1,
    meal_type: 'lunch',
    recipe_id: RECIPE_ID,
    recipe_version_id: VERSION_ID,
    status: 'completed',
    current_step: 2,
    total_steps: 2,
    instruction_snapshot: {
      ingredients: [{ name: 'Arroz', quantity: '600', unit: 'g' }],
      steps: [],
    },
    source_updated_at: '2026-10-28T12:00:00.000Z',
    source_calendar_payload_hash: 'a'.repeat(64),
    version: 3,
    started_at: '2026-10-28T12:00:00.000Z',
    updated_at: '2026-10-28T12:30:00.000Z',
    completed_at: '2026-10-28T12:30:00.000Z',
    cancelled_at: null,
    retention_until: null,
  };
}

function inventory(quantity = '1', expirationDate: string | null = null): RecipeInventoryItemRow {
  return {
    id: INVENTORY_ID,
    tenant_id: TENANT_ID,
    user_id: USER_ID,
    ingredient_name: 'Arroz',
    quantity,
    unit: 'kg',
    category: 'Granos',
    expiration_date: expirationDate,
    estimated_unit_price: null,
    purchase_location: null,
    low_stock_threshold: null,
    normalized_name: 'arroz',
    notes: null,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT_ID,
    userId: USER_ID,
    sessionId: SESSION_ID,
    expectedVersion: 3,
    idempotencyKey: 'reconcile-1',
    confirmed: true as const,
    items: [
      {
        originalIngredient: 'Arroz',
        outcome: 'used' as const,
        effectiveIngredient: 'Arroz',
        quantity: 600,
        unit: 'g',
        inventoryItemId: INVENTORY_ID,
        substituteIngredient: null,
        substituteInventoryItemId: null,
      },
    ],
    ...overrides,
  };
}

function clientFor(options: { inventory?: RecipeInventoryItemRow; claimMode?: string } = {}) {
  const { client, queries } = createQueryClient((sql) => {
    if (sql.includes('real_consumption_operations') && sql.includes('select id, request_hash')) {
      return [];
    }
    if (sql.includes('cooking_sessions')) return [session()];
    if (sql.includes('user_meal_plans')) return [{ consumption_payload: {} }];
    if (sql.includes('meal_consumption_claims') && sql.includes('select mode, operation_id')) {
      return options.claimMode ? [{ mode: options.claimMode, operation_id: null }] : [];
    }
    if (sql.includes('recipe_inventory_items') && sql.includes('select *')) {
      return options.inventory ? [options.inventory] : [];
    }
    if (sql.includes('insert into public.real_consumption_operations')) return [{ id: 'op-1' }];
    if (sql.includes('insert into public.meal_consumption_claims')) return [];
    if (sql.includes('insert into public.real_consumption_items')) return [{ id: 'item-1' }];
    if (sql.includes('insert into public.inventory_movements')) return [{ id: 'movement-1' }];
    return [];
  });
  return { client, queries };
}

describe('reconcileRealConsumptionInTransaction', () => {
  beforeEach(() => {
    mocks.revalidate.mockResolvedValue(true);
  });

  it('normalizes comparable units and creates one movement without touching unknown items', async () => {
    const { client, queries } = clientFor({ inventory: inventory() });
    const result = await reconcileRealConsumptionInTransaction(
      client,
      input(),
      new Date('2026-10-28T12:00:00.000Z')
    );

    expect(result).toMatchObject({
      status: 'applied',
      operationId: 'op-1',
      movementIds: ['movement-1'],
    });
    const itemInsert = queries.find((entry) =>
      entry.sql.includes('insert into public.real_consumption_items')
    );
    expect(itemInsert?.params).toContain(0.6);
    expect(itemInsert?.params).toContain('kg');
    expect(
      queries.filter((entry) => entry.sql.includes('insert into public.inventory_movements'))
    ).toHaveLength(1);
  });

  it('reads immutable audit rows without locks requiring UPDATE privileges', async () => {
    const { client, queries } = clientFor({ inventory: inventory() });
    await reconcileRealConsumptionInTransaction(client, input());

    const auditReads = queries.filter(({ sql }) =>
      /select [\s\S]*from public\.(real_consumption_operations|meal_consumption_claims)/.test(sql)
    );
    expect(auditReads).toHaveLength(2);
    for (const { sql } of auditReads) expect(sql).not.toMatch(/for (update|share)/i);
    for (const table of ['cooking_sessions', 'user_meal_plans', 'recipe_inventory_items']) {
      expect(
        queries.some(
          ({ sql }) => sql.includes(`from public.${table}`) && sql.includes('for update')
        )
      ).toBe(true);
    }
  });

  it('rejects an expired lot before creating an operation', async () => {
    const { client, queries } = clientFor({
      inventory: inventory('1', '2026-10-27T23:59:59.000Z'),
    });
    const result = await reconcileRealConsumptionInTransaction(
      client,
      input(),
      new Date('2026-10-28T12:00:00.000Z')
    );

    expect(result).toEqual({ status: 'inventory_expired' });
    expect(
      queries.some((entry) => entry.sql.includes('insert into public.real_consumption_operations'))
    ).toBe(false);
  });

  it('records unknown use without inventing a quantity or movement', async () => {
    const { client, queries } = clientFor();
    const result = await reconcileRealConsumptionInTransaction(
      client,
      input({
        items: [
          {
            originalIngredient: 'Arroz',
            outcome: 'unknown' as const,
            effectiveIngredient: null,
            quantity: null,
            unit: null,
            inventoryItemId: null,
            substituteIngredient: null,
            substituteInventoryItemId: null,
          },
        ],
      })
    );

    expect(result).toMatchObject({ status: 'applied', movementIds: [] });
    expect(
      queries.some((entry) => entry.sql.includes('update public.recipe_inventory_items'))
    ).toBe(false);
    expect(
      queries.some((entry) => entry.sql.includes('insert into public.inventory_movements'))
    ).toBe(false);
  });

  it('rejects insufficient stock before inserting the audit operation', async () => {
    const { client, queries } = clientFor({ inventory: inventory('0.5') });
    const result = await reconcileRealConsumptionInTransaction(client, input());

    expect(result).toEqual({ status: 'inventory_insufficient' });
    expect(
      queries.some((entry) => entry.sql.includes('insert into public.real_consumption_operations'))
    ).toBe(false);
  });

  it('does not let a planned legacy claim be reconciled', async () => {
    const { client, queries } = clientFor({ claimMode: 'planned_legacy' });
    const result = await reconcileRealConsumptionInTransaction(client, input());

    expect(result).toEqual({ status: 'legacy_already_claimed' });
    expect(
      queries.some((entry) => entry.sql.includes('insert into public.real_consumption_operations'))
    ).toBe(false);
  });

  it('returns the existing claim mode to the legacy path', async () => {
    const { client, queries } = createQueryClient((sql) => {
      if (sql.includes('select mode from public.meal_consumption_claims')) {
        return [{ mode: 'real_reconciliation' }];
      }
      return [];
    });
    const result = await claimPlannedMealInTransaction(client, {
      tenantId: TENANT_ID,
      userId: USER_ID,
      mealPlanId: PLAN_ID,
      dayIndex: 1,
      mealType: 'lunch',
    });

    expect(result).toEqual({ status: 'already_claimed', mode: 'real_reconciliation' });
    expect(
      queries.find(({ sql }) => sql.includes('select mode from public.meal_consumption_claims'))
        ?.sql
    ).not.toMatch(/for (update|share)/i);
    expect(
      queries.some((entry) => entry.sql.includes('insert into public.meal_consumption_claims'))
    ).toBe(false);
  });
});
