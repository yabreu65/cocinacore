import { createHash, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { Pool, types } from 'pg';
import { installResponseCookies } from '../fixtures/auth';
import {
  assertE2EDisposableIsolation,
  closeE2EDatabase,
  resolveAuthenticatedE2EIdentity,
} from '../fixtures/database';
import { validateE2ETargets } from '../database-target';

const { databaseUrl } = validateE2ETargets(process.env);
types.setTypeParser(types.builtins.TIMESTAMPTZ, (value: string) => value);
const pool = new Pool({ connectionString: databaseUrl });
const runId = `u4-${Date.now()}`;
const title = `E2E U4 reconciliation ${runId}`;

type Fixture = {
  email: string;
  tenantId: string;
  userId: string;
  recipeId: string;
  versionId: string;
  planId: string;
  sessionId: string;
  inventoryId: string;
  calendarPayload: Record<string, unknown>;
  updatedAt: string;
};

let credentials: { email: string; password: string } | null = null;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

async function authenticate(page: Page): Promise<void> {
  credentials ??= {
    email: `u4-${runId}@cocinacore.local`,
    password: 'TestPassword123!',
  };
  const signup = await page.request.post('/api/auth/signup', {
    data: {
      ...credentials,
      confirmPassword: credentials.password,
      fullName: 'M5 U4 E2E',
      termsAccepted: true,
    },
  });
  if (!signup.ok()) throw new Error(`U4 fixture signup failed (${signup.status()}).`);
  await installResponseCookies(page, signup);
}

async function seedFixture(page: Page): Promise<Fixture> {
  await assertE2EDisposableIsolation(pool);
  await authenticate(page);
  const identity = await resolveAuthenticatedE2EIdentity(page);
  const recipeId = randomUUID();
  const versionId = randomUUID();
  const planId = randomUUID();
  const sessionId = randomUUID();
  const inventoryId = randomUUID();
  const seed: Fixture = {
    email: credentials?.email ?? '',
    tenantId: identity.tenantId,
    userId: identity.userId,
    recipeId,
    versionId,
    planId,
    sessionId,
    inventoryId,
    calendarPayload: {},
    updatedAt: '',
  };
  const dayLabels = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const calendarPayload = {
    period: 'week',
    dayCount: 7,
    schedule: {
      startDate: '2026-10-28',
      timeZone: 'America/Caracas',
      confirmedAt: '2026-10-27T12:00:00.000Z',
      portionConfirmation: { peopleCount: 2, confirmedAt: '2026-10-27T12:00:00.000Z' },
    },
    days: Array.from({ length: 7 }, (_, index) => ({
      dayIndex: index + 1,
      label: dayLabels[index],
      meals: [
        {
          mealType: 'breakfast',
          title: 'U4 breakfast',
          prepMinutes: 10,
          description: null,
          ingredients: [{ name: 'Bread', quantity: 1, unit: 'unidad' }],
        },
        {
          mealType: 'lunch',
          title: 'U4 lunch',
          prepMinutes: 20,
          description: null,
          ingredients: [{ name: 'Rice', quantity: 600, unit: 'g' }],
          ...(index === 0 ? { recipeRef: { recipeId, versionId } } : {}),
        },
        {
          mealType: 'dinner',
          title: 'U4 dinner',
          prepMinutes: 15,
          description: null,
          ingredients: [{ name: 'Soup', quantity: 1, unit: 'l' }],
        },
      ],
    })),
  };

  const client = await pool.connect();
  let failure: unknown = null;
  try {
    await client.query('begin');
    await client.query(
      `insert into public.user_recipes (id, tenant_id, user_id, category, tags)
       values ($1, $2, $3, 'e2e', $4)`,
      [recipeId, identity.tenantId, identity.userId, [`m5-u4-${runId}`]]
    );
    await client.query(
      `insert into public.user_recipe_versions
       (id, recipe_id, tenant_id, user_id, version_number, title, instructions, servings, ingredients)
       values ($1, $2, $3, $4, 1, $5, 'Use the measured ingredients.', 2, $6::jsonb)`,
      [
        versionId,
        recipeId,
        identity.tenantId,
        identity.userId,
        title,
        JSON.stringify([{ name: 'Rice', quantity: '600', unit: 'g' }]),
      ]
    );
    const plan = await client.query<{ updated_at: string }>(
      `insert into public.user_meal_plans
       (id, tenant_id, user_id, people_count, period, mode, base_cuisine, calendar_payload)
       values ($1, $2, $3, 2, 'week', 'menu_to_shopping', 'e2e', $4::jsonb)
       returning updated_at`,
      [planId, identity.tenantId, identity.userId, JSON.stringify(calendarPayload)]
    );
    await client.query(
      `insert into public.cooking_sessions
       (id, tenant_id, user_id, meal_plan_id, day_index, meal_type, recipe_id, recipe_version_id,
        status, current_step, total_steps, instruction_snapshot, source_updated_at, source_calendar_payload_hash, version, completed_at)
       values ($1, $2, $3, $4, 1, 'lunch', $5, $6, 'completed', 1, 1, $7::jsonb, $8, $9, 1, now())`,
      [
        sessionId,
        identity.tenantId,
        identity.userId,
        planId,
        recipeId,
        versionId,
        JSON.stringify({
          recipeId,
          versionId,
          servings: 2,
          ingredients: [{ name: 'Rice', quantity: '600', unit: 'g' }],
          steps: [{ index: 1, title: 'Use rice', instruction: 'Use the measured ingredients.' }],
        }),
        plan.rows[0].updated_at,
        hash(calendarPayload),
      ]
    );
    await client.query(
      `insert into public.recipe_inventory_items
       (id, tenant_id, user_id, ingredient_name, quantity, unit, normalized_name, expiration_date)
       values ($1, $2, $3, 'Rice', '1', 'kg', 'rice', $4)`,
      [
        inventoryId,
        identity.tenantId,
        identity.userId,
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      ]
    );
    await client.query('commit');
    seed.calendarPayload = calendarPayload;
    seed.updatedAt = plan.rows[0].updated_at;
  } catch (error) {
    failure = error;
    try {
      await client.query('rollback');
    } catch (rollbackError) {
      failure = new AggregateError(
        [error, rollbackError],
        'U4 fixture transaction rollback failed.'
      );
    }
  } finally {
    client.release();
  }

  if (failure) {
    try {
      await cleanupFixture(seed);
    } catch (cleanupError) {
      throw new AggregateError([failure, cleanupError], 'U4 fixture setup and cleanup failed.');
    }
    throw failure;
  }

  return seed;
}

async function cleanupFixture(seed: Fixture | null): Promise<void> {
  if (!seed) return;

  const audit = await pool.query<{ count: string }>(
    `select count(*)::text as count
       from public.real_consumption_operations
      where cooking_session_id = $1 and tenant_id = $2 and user_id = $3`,
    [seed.sessionId, seed.tenantId, seed.userId]
  );
  if (audit.rows[0]?.count !== '0') {
    // Migration 019 is append-only. Retain the dependency closure in the
    // disposable database and destroy the database after the E2E execution.
    return;
  }
  await pool.query(
    `delete from public.inventory_movements
     where tenant_id=$1 and user_id=$2 and inventory_item_id=$3`,
    [seed.tenantId, seed.userId, seed.inventoryId]
  );
  await pool.query(
    `delete from public.cooking_sessions
     where id=$1 and tenant_id=$2 and user_id=$3 and meal_plan_id=$4`,
    [seed.sessionId, seed.tenantId, seed.userId, seed.planId]
  );
  await pool.query(
    `delete from public.user_meal_plans
     where id=$1 and tenant_id=$2 and user_id=$3`,
    [seed.planId, seed.tenantId, seed.userId]
  );
  await pool.query(
    `delete from public.user_recipe_versions
     where id=$1 and recipe_id=$2 and tenant_id=$3 and user_id=$4`,
    [seed.versionId, seed.recipeId, seed.tenantId, seed.userId]
  );
  await pool.query(
    `delete from public.user_recipes
     where id=$1 and tenant_id=$2 and user_id=$3`,
    [seed.recipeId, seed.tenantId, seed.userId]
  );
  await pool.query(
    `delete from public.recipe_inventory_items
     where id=$1 and tenant_id=$2 and user_id=$3`,
    [seed.inventoryId, seed.tenantId, seed.userId]
  );
  await pool.query(
    `delete from public.users
     where id=$1 and tenant_id=$2 and email=$3`,
    [seed.userId, seed.tenantId, seed.email]
  );
  await pool.query(
    `delete from public.tenants t
     where t.id=$1
       and not exists (select 1 from public.users u where u.tenant_id=t.id)
       and not exists (select 1 from public.tenant_memberships m where m.tenant_id=t.id)`,
    [seed.tenantId]
  );

  const residuals = await pool.query<{ count: string }>(
    `select (
       select count(*)::text from public.cooking_sessions
       where id=$1 and tenant_id=$2 and user_id=$3
     ) as count
     union all
     select (
       select count(*)::text from public.user_meal_plans
       where id=$4 and tenant_id=$2 and user_id=$3
     )
     union all
     select (
       select count(*)::text from public.recipe_inventory_items
       where id=$5 and tenant_id=$2 and user_id=$3
     )`,
    [seed.sessionId, seed.tenantId, seed.userId, seed.planId, seed.inventoryId]
  );
  if (residuals.rows.some((row) => row.count !== '0')) {
    throw new Error('U4 fixture cleanup left scoped mutable rows behind.');
  }
}

test.describe('M5 U4 real consumption reconciliation', () => {
  test('reconciles one completed session once and preserves the legacy payload', async ({
    page,
  }) => {
    const fixture = await seedFixture(page);
    const endpoint = `/api/cooking-sessions/${fixture.sessionId}/reconciliation`;
    const body = {
      expectedVersion: 1,
      idempotencyKey: `reconcile-${runId}`,
      confirmed: true,
      items: [
        {
          originalIngredient: 'Rice',
          outcome: 'used',
          effectiveIngredient: 'Rice',
          quantity: 600,
          unit: 'g',
          inventoryItemId: fixture.inventoryId,
          substituteIngredient: null,
          substituteInventoryItemId: null,
        },
      ],
    };

    try {
      const first = await page.request.post(endpoint, { data: body });
      const firstText = await first.text();
      expect(first.status(), firstText).toBe(201);
      expect(JSON.parse(firstText) as { movementCount: number }).toMatchObject({
        movementCount: 1,
      });

      const replay = await page.request.post(endpoint, { data: body });
      expect(replay.status()).toBe(200);
      expect((await replay.json()) as { status: string }).toMatchObject({
        status: 'already_applied',
      });

      const contradictory = await page.request.post(endpoint, {
        data: { ...body, items: [{ ...body.items[0], quantity: 500 }] },
      });
      expect(contradictory.status()).toBe(409);

      const state = await pool.query<{
        quantity: string;
        movement_count: string;
        operation_count: string;
      }>(
        `select
           (select quantity from public.recipe_inventory_items where id = $1) as quantity,
           (select count(*)::text from public.inventory_movements where tenant_id = $4 and source like $2) as movement_count,
           (select count(*)::text from public.real_consumption_operations where cooking_session_id = $3) as operation_count`,
        [fixture.inventoryId, `real-consumption:%`, fixture.sessionId, fixture.tenantId]
      );
      expect(state.rows[0]).toEqual({ quantity: '0.4', movement_count: '1', operation_count: '1' });

      const legacyPayload = await pool.query<{ consumption_payload: unknown }>(
        'select consumption_payload from public.user_meal_plans where id = $1',
        [fixture.planId]
      );
      expect(legacyPayload.rows[0].consumption_payload).toEqual({});

      const options = await page.request.get(endpoint);
      expect(options.status()).toBe(200);
      expect((await options.json()) as { inventory: Array<{ id: string }> }).toMatchObject({
        inventory: [{ id: fixture.inventoryId }],
      });
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test.afterAll(async () => {
    await pool.end();
    await closeE2EDatabase();
  });
});
