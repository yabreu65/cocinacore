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

function clientFor(
  options: {
    inventory?: RecipeInventoryItemRow;
    claimMode?: string;
    planMissing?: boolean;
    consumptionPayload?: unknown;
    session?: CookingSessionRow;
    requestHash?: string;
    snapshotHash?: string;
    legacyReceipt?: boolean;
  } = {}
) {
  let itemCount = 0;
  let movementCount = 0;
  const { client, queries } = createQueryClient((sql) => {
    if (sql.includes('real_consumption_operations') && sql.includes('select id, request_hash')) {
      return options.requestHash
        ? [
            {
              id: 'op-1',
              request_hash: options.requestHash,
              source_snapshot_hash: options.snapshotHash,
            },
          ]
        : [];
    }
    if (sql.includes('select ingredient_index, original_ingredient'))
      return [
        {
          ingredient_index: options.legacyReceipt ? null : 0,
          original_ingredient: 'Arroz',
          outcome: 'used',
          quantity_status: 'known',
        },
      ];
    if (sql.includes('select movement_id from public.real_consumption_movement_links'))
      return [{ movement_id: 'movement-1' }];
    if (sql.includes('cooking_sessions')) return [options.session ?? session()];
    if (sql.includes('user_meal_plans'))
      return options.planMissing
        ? []
        : [
            {
              period: 'week',
              consumption_payload: options.consumptionPayload ?? {},
              calendar_payload: {
                period: 'week',
                dayCount: 7,
                days: Array.from({ length: 7 }, (_, i) => ({
                  dayIndex: i + 1,
                  meals: ['breakfast', 'lunch', 'dinner'].map((mealType) => ({
                    mealType,
                    title: 'Arroz',
                    description: null,
                    ingredients: [{ name: 'Arroz', quantity: 600, unit: 'g' }],
                  })),
                })),
                schedule: {
                  startDate: '2026-10-28',
                  timeZone: 'America/Bogota',
                  confirmedAt: '2026-10-27T12:00:00.000Z',
                  portionConfirmation: { peopleCount: 2, confirmedAt: '2026-10-27T12:00:00.000Z' },
                },
              },
            },
          ];
    if (sql.includes('meal_consumption_claims') && sql.includes('select mode, operation_id')) {
      return options.claimMode ? [{ mode: options.claimMode, operation_id: null }] : [];
    }
    if (sql.includes('recipe_inventory_items') && sql.includes('select *')) {
      return options.inventory ? [options.inventory] : [];
    }
    if (sql.includes('insert into public.real_consumption_operations')) return [{ id: 'op-1' }];
    if (sql.includes('insert into public.meal_consumption_claims')) return [];
    if (sql.includes('insert into public.real_consumption_items'))
      return [{ id: 'item-' + ++itemCount }];
    if (sql.includes('update public.recipe_inventory_items')) return [{ id: INVENTORY_ID }];
    if (sql.includes('insert into public.inventory_movements'))
      return [{ id: 'movement-' + ++movementCount }];
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
    expect(queries[1].params).toEqual(['cocinacore:inventory-source:v1:' + TENANT_ID]);
    expect(
      queries.find((q) => q.sql.includes('update public.recipe_inventory_items'))?.params?.[0]
    ).toBe('0.4');
    expect(
      queries.find((q) => q.sql.includes('insert into public.inventory_movements'))?.params?.[3]
    ).toBe(0.6);
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

  it.each(['1/3', '0.00001', '999999999'])(
    'rejects unrepresentable stock %s before any audit writes',
    async (quantity) => {
      const { client, queries } = clientFor({ inventory: inventory(quantity) });
      const result = await reconcileRealConsumptionInTransaction(client, input());
      expect(result).toEqual({ status: 'unrepresentable_inventory_quantity' });
      expect(
        queries.some((q) => q.sql.includes('insert into public.real_consumption_operations'))
      ).toBe(false);
    }
  );
  it('rejects a positive subprecision conversion rather than rounding to zero', async () => {
    const { client, queries } = clientFor({ inventory: inventory() });
    const original = input();
    const result = await reconcileRealConsumptionInTransaction(client, {
      ...original,
      items: [{ ...original.items[0], quantity: 0.01 }],
    });
    expect(result).toEqual({ status: 'unrepresentable_inventory_quantity' });
    expect(
      queries.some((q) => q.sql.includes('insert into public.real_consumption_operations'))
    ).toBe(false);
  });
  it('rejects conflicting embedded units', async () => {
    const { client, queries } = clientFor({ inventory: inventory('1000 g') });
    expect(await reconcileRealConsumptionInTransaction(client, input())).toEqual({
      status: 'incompatible_units',
    });
    expect(
      queries.some((q) => q.sql.includes('insert into public.real_consumption_operations'))
    ).toBe(false);
  });
  it('allows the expiration calendar day in the scheduled timezone', async () => {
    const { client } = clientFor({ inventory: inventory('1', '2026-10-28 00:00:00+00') });
    expect(
      await reconcileRealConsumptionInTransaction(client, input(), new Date('2026-10-28T23:00:00Z'))
    ).toMatchObject({ status: 'applied' });
  });
  it.each(['bad-date', '2026-10-27 00:00:00+00'])(
    'blocks invalid or expired date %s',
    async (expiry) => {
      const { client, queries } = clientFor({ inventory: inventory('1', expiry) });
      expect(
        await reconcileRealConsumptionInTransaction(
          client,
          input(),
          new Date('2026-10-28T23:00:00Z')
        )
      ).toEqual({ status: 'inventory_expired' });
      expect(
        queries.some((q) => q.sql.includes('insert into public.real_consumption_operations'))
      ).toBe(false);
    }
  );
  it.each([{ planMissing: true }, { consumptionPayload: { '2:lunch': { broken: true } } }])(
    'fails closed on missing or malformed plan evidence',
    async (options) => {
      const { client, queries } = clientFor(options);
      expect(await reconcileRealConsumptionInTransaction(client, input())).toEqual({
        status: 'source_conflict',
      });
      expect(
        queries.some((q) => q.sql.includes('insert into public.real_consumption_operations'))
      ).toBe(false);
    }
  );
  function duplicatedSession() {
    return {
      ...session(),
      instruction_snapshot: {
        ingredients: [
          { name: 'Arroz', quantity: '300', unit: 'g' },
          { name: ' ARROZ ', quantity: '400', unit: 'g' },
        ],
        steps: [],
      },
    };
  }
  function duplicatedInput(first = 300, second = 400) {
    const original = input();
    return {
      ...original,
      items: [
        { ...original.items[0], ingredientIndex: 0, quantity: first },
        { ...original.items[0], ingredientIndex: 1, originalIngredient: 'ARROZ', quantity: second },
      ],
    };
  }
  it('deducts separate occurrences from the same lot with exact cumulative balances', async () => {
    const { client, queries } = clientFor({ session: duplicatedSession(), inventory: inventory() });
    const result = await reconcileRealConsumptionInTransaction(client, duplicatedInput());
    expect(result).toMatchObject({
      status: 'applied',
      movementIds: ['movement-1', 'movement-2'],
      items: [
        { ingredientIndex: 0, originalIngredient: 'Arroz' },
        { ingredientIndex: 1, originalIngredient: 'ARROZ' },
      ],
    });
    expect(
      queries.filter((q) => q.sql.includes('select * from public.recipe_inventory_items'))
    ).toHaveLength(1);
    expect(
      queries
        .filter((q) => q.sql.includes('update public.recipe_inventory_items'))
        .map((q) => q.params?.[0])
    ).toEqual(['0.7', '0.3']);
    expect(
      queries
        .filter((q) => q.sql.includes('insert into public.inventory_movements'))
        .map((q) => q.params?.[3])
    ).toEqual([0.3, 0.4]);
    expect(
      queries
        .filter((q) => q.sql.includes('insert into public.real_consumption_items'))
        .map((q) => [q.params?.[4], q.params?.[12]])
    ).toEqual([
      ['arroz', 0],
      ['arroz', 1],
    ]);
    expect(
      queries
        .filter((q) => q.sql.includes('insert into public.real_consumption_movement_links'))
        .map((q) => q.params?.slice(1, 3))
    ).toEqual([
      ['item-1', 'movement-1'],
      ['item-2', 'movement-2'],
    ]);
  });
  it('rejects cumulative overdraw before creating any audit or stock writes', async () => {
    const { client, queries } = clientFor({ session: duplicatedSession(), inventory: inventory() });
    expect(await reconcileRealConsumptionInTransaction(client, duplicatedInput(600, 600))).toEqual({
      status: 'inventory_insufficient',
    });
    expect(queries.some((q) => /insert into|update public/.test(q.sql))).toBe(false);
  });
  it.each(['duplicate-index', 'missing-index', 'wrong-index', 'wrong-name'] as const)(
    'rejects %s without claiming a slot',
    async (kind) => {
      const { client, queries } = clientFor({
        session: duplicatedSession(),
        inventory: inventory(),
      });
      const request = duplicatedInput();
      if (kind === 'duplicate-index') request.items[1].ingredientIndex = 0;
      if (kind === 'wrong-index') request.items[1].ingredientIndex = 2;
      if (kind === 'wrong-name') request.items[1].originalIngredient = 'Sal';
      const items = request.items.map((item, i) =>
        kind === 'missing-index' && i === 1 ? { ...item, ingredientIndex: undefined } : item
      );
      expect(await reconcileRealConsumptionInTransaction(client, { ...request, items })).toEqual({
        status: 'invalid_items',
      });
      expect(queries.some((q) => /insert into|update public/.test(q.sql))).toBe(false);
    }
  );
  it('replays an identical request without writing stock or audit again', async () => {
    const request = input();
    const initial = clientFor({ inventory: inventory() });
    await reconcileRealConsumptionInTransaction(initial.client, request);
    const hash = initial.queries.find((q) =>
      q.sql.includes('insert into public.real_consumption_operations')
    )?.params?.[9];
    expect(typeof hash).toBe('string');
    const retry = clientFor({ requestHash: String(hash) });
    expect(await reconcileRealConsumptionInTransaction(retry.client, request)).toMatchObject({
      status: 'already_applied',
      movementIds: ['movement-1'],
    });
    expect(retry.queries.some((q) => /insert into|update public/.test(q.sql))).toBe(false);
    expect(
      await reconcileRealConsumptionInTransaction(retry.client, {
        ...request,
        items: [{ ...request.items[0], quantity: 1 }],
      })
    ).toEqual({ status: 'conflict' });
  });
  it('recovers a pre-022 receipt when the upgraded client adds only the correct occurrence index', async () => {
    const request = input();
    const initial = clientFor({ inventory: inventory() });
    await reconcileRealConsumptionInTransaction(initial.client, request);
    const params = initial.queries.find((q) =>
      q.sql.includes('insert into public.real_consumption_operations')
    )?.params;
    const retry = clientFor({
      requestHash: String(params?.[9]),
      snapshotHash: String(params?.[10]),
      legacyReceipt: true,
    });
    mocks.revalidate.mockResolvedValue(false); // live plan can have changed since the durable receipt.
    const result = await reconcileRealConsumptionInTransaction(retry.client, {
      ...request,
      items: [{ ...request.items[0], ingredientIndex: 0 }],
    });
    expect(result).toMatchObject({
      status: 'already_applied',
      operationId: 'op-1',
      items: [{ originalIngredient: 'Arroz', outcome: 'used' }],
      movementIds: ['movement-1'],
    });
    expect(
      retry.queries.some((q) =>
        /insert into|update public|from public.recipe_inventory_items|from public.user_meal_plans/.test(
          q.sql
        )
      )
    ).toBe(false);
    expect(mocks.revalidate).not.toHaveBeenCalledWith(retry.client, expect.anything());
  });
  it.each([
    'wrong-index',
    'changed-quantity',
    'changed-unit',
    'changed-lot',
    'changed-outcome',
    'changed-version',
    'changed-snapshot',
    'missing-snapshot-hash',
  ] as const)('rejects legacy replay with %s without writes', async (kind) => {
    const request = input();
    const initial = clientFor({ inventory: inventory() });
    await reconcileRealConsumptionInTransaction(initial.client, request);
    const params = initial.queries.find((q) =>
      q.sql.includes('insert into public.real_consumption_operations')
    )?.params;
    const retry = clientFor({
      requestHash: String(params?.[9]),
      snapshotHash: kind === 'missing-snapshot-hash' ? undefined : String(params?.[10]),
      legacyReceipt: true,
      session: kind === 'changed-snapshot' ? duplicatedSession() : session(),
    });
    const item = { ...request.items[0], ingredientIndex: 0 };
    if (kind === 'wrong-index') item.ingredientIndex = 1;
    if (kind === 'changed-quantity') item.quantity = 700;
    if (kind === 'changed-unit') item.unit = 'kg';
    if (kind === 'changed-lot') item.inventoryItemId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const changed = {
      ...request,
      expectedVersion: kind === 'changed-version' ? 4 : request.expectedVersion,
      items: [kind === 'changed-outcome' ? { ...item, outcome: 'unknown' as const } : item],
    };
    expect(await reconcileRealConsumptionInTransaction(retry.client, changed)).toEqual({
      status: 'conflict',
    });
    expect(retry.queries.some((q) => /insert into|update public/.test(q.sql))).toBe(false);
  });
  it('does not strip indices from a receipt whose original request included them', async () => {
    const request = { ...input(), items: [{ ...input().items[0], ingredientIndex: 0 }] };
    const initial = clientFor({ inventory: inventory() });
    await reconcileRealConsumptionInTransaction(initial.client, request);
    const params = initial.queries.find((q) =>
      q.sql.includes('insert into public.real_consumption_operations')
    )?.params;
    const retry = clientFor({
      requestHash: String(params?.[9]),
      snapshotHash: String(params?.[10]),
    });
    expect(await reconcileRealConsumptionInTransaction(retry.client, request)).toMatchObject({
      status: 'already_applied',
    });
    expect(
      await reconcileRealConsumptionInTransaction(retry.client, {
        ...request,
        items: [{ ...request.items[0], ingredientIndex: 1 }],
      })
    ).toEqual({ status: 'conflict' });
    expect(retry.queries.some((q) => /insert into|update public/.test(q.sql))).toBe(false);
  });
  it('converts a tablespoon into three teaspoons before persisting a deduction', async () => {
    const { client, queries } = clientFor({
      inventory: { ...inventory('4'), unit: 'cucharadita' },
    });
    const request = input();
    const result = await reconcileRealConsumptionInTransaction(client, {
      ...request,
      items: [{ ...request.items[0], quantity: 1, unit: 'cucharada' }],
    });
    expect(result).toMatchObject({ status: 'applied' });
    expect(
      queries.find((q) => q.sql.includes('update public.recipe_inventory_items'))?.params?.[0]
    ).toBe('1');
    expect(
      queries.find((q) => q.sql.includes('insert into public.inventory_movements'))?.params?.[3]
    ).toBe(3);
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
