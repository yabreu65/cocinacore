import { createHash, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { installResponseCookies } from '../fixtures/auth';
import { resolveAuthenticatedE2EIdentity } from '../fixtures/database';
import { validateE2ETargets } from '../database-target';

const { databaseUrl } = validateE2ETargets(process.env);
const pool = new Pool({ connectionString: databaseUrl });
const runId = `u3-${Date.now()}`;
const title = `E2E U3 cooking session ${runId}`;
const mealTypes = ['breakfast', 'lunch', 'dinner'] as const;

type Fixture = {
  tenantId: string;
  userId: string;
  recipeId: string;
  versionId: string;
  planId: string;
  calendarPayload: Record<string, unknown>;
  updatedAt: string;
  foreignSessionId: string;
  foreignTenantId: string;
  foreignUserId: string;
  foreignRecipeId: string;
  foreignVersionId: string;
  foreignPlanId: string;
};

type SessionResponse = {
  status?: string;
  code?: string;
  session?: { id: string; version: number; status: string };
};

let fixture: Fixture | null = null;
let authCredentials: { email: string; password: string } | null = null;

async function authenticateFixture(page: Page): Promise<void> {
  if (!authCredentials) {
    authCredentials = {
      email: `u3-${runId}@cocinacore.local`,
      password: 'TestPassword123!',
    };
    const signup = await page.request.post('/api/auth/signup', {
      data: {
        ...authCredentials,
        confirmPassword: authCredentials.password,
        fullName: 'M5 U3 E2E',
        termsAccepted: true,
      },
    });
    if (!signup.ok()) throw new Error(`U3 fixture signup failed (${signup.status()}).`);
    await installResponseCookies(page, signup);
    return;
  }
  const login = await page.request.post('/api/auth/login', { data: authCredentials });
  if (!login.ok()) throw new Error(`U3 fixture login failed (${login.status()}).`);
  await installResponseCookies(page, login);
}

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

function payloadHash(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function buildCalendarPayload(recipeId: string, versionId: string): Record<string, unknown> {
  const labels = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  return {
    period: 'week',
    dayCount: 7,
    schedule: {
      startDate: '2026-10-28',
      timeZone: 'America/Caracas',
      confirmedAt: '2026-10-27T12:00:00.000Z',
      portionConfirmation: { peopleCount: 2, confirmedAt: '2026-10-27T12:00:00.000Z' },
    },
    days: labels.map((label, index) => ({
      dayIndex: index + 1,
      label,
      meals: mealTypes.map((mealType) => ({
        mealType,
        title: `Fixture ${mealType}`,
        prepMinutes: 20,
        description: null,
        ingredients: [{ name: 'Rice', quantity: 1, unit: 'cup' }],
        ...((index === 0 && mealType === 'lunch') ||
        (index === 1 && mealType === 'dinner') ||
        (index === 2 && mealType === 'breakfast')
          ? { recipeRef: { recipeId, versionId } }
          : {}),
      })),
    })),
  };
}

async function seedFixture(page: Page): Promise<Fixture> {
  await authenticateFixture(page);
  const identity = await resolveAuthenticatedE2EIdentity(page);
  const recipeId = randomUUID();
  const versionId = randomUUID();
  const planId = randomUUID();
  const foreignTenantId = randomUUID();
  const foreignUserId = randomUUID();
  const foreignRecipeId = randomUUID();
  const foreignVersionId = randomUUID();
  const foreignPlanId = randomUUID();
  const foreignSessionId = randomUUID();
  const calendarPayload = buildCalendarPayload(recipeId, versionId);

  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `insert into public.user_recipes (id, tenant_id, user_id, category, tags)
       values ($1, $2, $3, 'e2e', $4)`,
      [recipeId, identity.tenantId, identity.userId, [`m5-u3-${runId}`]]
    );
    await client.query(
      `insert into public.user_recipe_versions
       (id, recipe_id, tenant_id, user_id, version_number, title, instructions, servings, ingredients)
       values ($1, $2, $3, $4, 1, $5, 'Mix the ingredients.', 2, $6::jsonb)`,
      [
        versionId,
        recipeId,
        identity.tenantId,
        identity.userId,
        title,
        JSON.stringify([{ name: 'Rice', quantity: '1', unit: 'cup' }]),
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
      `insert into public.tenants (id, tenant_type, name) values ($1, 'home', $2)`,
      [foreignTenantId, `U3 foreign ${runId}`]
    );
    await client.query(
      `insert into public.users
       (id, email, password_hash, email_confirmed, full_name, tenant_id, role, terms_accepted_at, terms_version, onboarding_completed)
       values ($1, $2, 'fixture', true, 'U3 foreign', $3, 'owner', now(), 'v1', true)`,
      [foreignUserId, `u3-foreign-${runId}@cocinacore.local`, foreignTenantId]
    );
    await client.query(
      `insert into public.tenant_memberships (tenant_id, user_id, role) values ($1, $2, 'owner')`,
      [foreignTenantId, foreignUserId]
    );
    await client.query(
      `insert into public.user_recipes (id, tenant_id, user_id, category)
       values ($1, $2, $3, 'e2e')`,
      [foreignRecipeId, foreignTenantId, foreignUserId]
    );
    await client.query(
      `insert into public.user_recipe_versions
       (id, recipe_id, tenant_id, user_id, version_number, title, instructions, servings, ingredients)
       values ($1, $2, $3, $4, 1, 'Foreign fixture', 'Foreign instructions.', 2, $5::jsonb)`,
      [
        foreignVersionId,
        foreignRecipeId,
        foreignTenantId,
        foreignUserId,
        JSON.stringify([{ name: 'Rice', quantity: '1', unit: 'cup' }]),
      ]
    );
    const foreignCalendar = buildCalendarPayload(foreignRecipeId, foreignVersionId);
    const foreignPlan = await client.query<{ updated_at: string }>(
      `insert into public.user_meal_plans
       (id, tenant_id, user_id, people_count, period, mode, base_cuisine, calendar_payload)
       values ($1, $2, $3, 2, 'week', 'menu_to_shopping', 'e2e', $4::jsonb)
       returning updated_at`,
      [foreignPlanId, foreignTenantId, foreignUserId, JSON.stringify(foreignCalendar)]
    );
    await client.query(
      `insert into public.cooking_sessions
       (id, tenant_id, user_id, meal_plan_id, day_index, meal_type, recipe_id, recipe_version_id,
        status, current_step, total_steps, instruction_snapshot, source_updated_at, source_calendar_payload_hash)
       values ($1, $2, $3, $4, 1, 'lunch', $5, $6, 'active', 1, 1, $7::jsonb, $8, $9)`,
      [
        foreignSessionId,
        foreignTenantId,
        foreignUserId,
        foreignPlanId,
        foreignRecipeId,
        foreignVersionId,
        JSON.stringify({
          recipeId: foreignRecipeId,
          versionId: foreignVersionId,
          servings: 2,
          ingredients: [{ name: 'Rice', quantity: '1', unit: 'cup' }],
          steps: [{ index: 1, title: 'Foreign fixture', instruction: 'Foreign instructions.' }],
        }),
        foreignPlan.rows[0].updated_at,
        payloadHash(foreignCalendar),
      ]
    );
    await client.query('commit');
    return {
      tenantId: identity.tenantId,
      userId: identity.userId,
      recipeId,
      versionId,
      planId,
      calendarPayload,
      updatedAt: plan.rows[0].updated_at,
      foreignSessionId,
      foreignTenantId,
      foreignUserId,
      foreignRecipeId,
      foreignVersionId,
      foreignPlanId,
    };
  } catch (error) {
    try {
      await client.query('rollback');
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'U3 fixture rollback failed.');
    }
    throw error;
  } finally {
    client.release();
  }
}

async function findSessionId(): Promise<string> {
  if (!fixture) throw new Error('Fixture not seeded.');
  const result = await pool.query<{ id: string }>(
    `select id from public.cooking_sessions where tenant_id = $1 and user_id = $2 and meal_plan_id = $3 and day_index = 1 and meal_type = 'lunch'`,
    [fixture.tenantId, fixture.userId, fixture.planId]
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error('Expected U3 session was not persisted.');
  return id;
}

test.describe('M5 U3 cooking sessions', () => {
  test.describe.configure({ mode: 'serial' });

  test.afterAll(async () => {
    try {
      if (fixture) {
        // Delete only sessions generated for this fixture's plan and user.
        const scopedSession = `select id from public.cooking_sessions
          where tenant_id = $1 and user_id = $2 and meal_plan_id = $3`;
        await pool.query(
          `delete from public.cooking_session_events where session_id in (${scopedSession})`,
          [fixture.tenantId, fixture.userId, fixture.planId]
        );
        await pool.query(
          `delete from public.cooking_sessions
           where tenant_id = $1 and user_id = $2 and meal_plan_id = $3`,
          [fixture.tenantId, fixture.userId, fixture.planId]
        );
        await pool.query(
          `delete from public.user_meal_plans where id = $1 and tenant_id = $2 and user_id = $3`,
          [fixture.planId, fixture.tenantId, fixture.userId]
        );
        await pool.query('delete from public.user_recipe_versions where id = $1', [
          fixture.versionId,
        ]);
        await pool.query('delete from public.user_recipes where id = $1', [fixture.recipeId]);

        // Foreign fixtures are explicitly owned by this test. Never delete the real tenant.
        await pool.query('delete from public.cooking_session_events where session_id = $1', [
          fixture.foreignSessionId,
        ]);
        await pool.query('delete from public.cooking_sessions where id = $1 and tenant_id = $2', [
          fixture.foreignSessionId,
          fixture.foreignTenantId,
        ]);
        await pool.query('delete from public.user_meal_plans where id = $1 and tenant_id = $2', [
          fixture.foreignPlanId,
          fixture.foreignTenantId,
        ]);
        await pool.query('delete from public.user_recipe_versions where id = $1', [
          fixture.foreignVersionId,
        ]);
        await pool.query('delete from public.user_recipes where id = $1 and tenant_id = $2', [
          fixture.foreignRecipeId,
          fixture.foreignTenantId,
        ]);
        await pool.query(
          'delete from public.tenant_memberships where tenant_id = $1 and user_id = $2',
          [fixture.foreignTenantId, fixture.foreignUserId]
        );
        await pool.query('delete from public.users where id = $1 and tenant_id = $2', [
          fixture.foreignUserId,
          fixture.foreignTenantId,
        ]);
        await pool.query('delete from public.tenants where id = $1', [fixture.foreignTenantId]);
      }
    } finally {
      await pool.end();
    }
  });

  test('runs the guided flow, reloads from PostgreSQL, and never mutates business data', async ({
    page,
  }) => {
    fixture = await seedFixture(page);
    await page.goto('/recipes');
    const card = page.locator('li').filter({ hasText: title }).first();
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Preparar esta receta' }).click();
    await expect(card.getByLabel('Comida asociada del menú')).toBeVisible();
    await card.getByRole('button', { name: 'Iniciar preparación' }).click();
    await expect(card.getByRole('status')).toContainText('Paso 1 de 1 · En preparación');
    await expect(
      card.getByRole('list', { name: 'Ingredientes previstos' }).getByRole('listitem')
    ).toContainText('1 cup Rice');
    await expect(card.getByText('Mix the ingredients.')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    await expect(card.getByRole('button', { name: 'Siguiente' })).toHaveCount(0);

    await card.getByRole('button', { name: 'Pausar' }).click();
    await expect(card.getByRole('status')).toContainText('Pausada');
    await page.reload();
    const reloadedCard = page.locator('li').filter({ hasText: title }).first();
    await reloadedCard.getByRole('button', { name: 'Preparar esta receta' }).click();
    await expect(reloadedCard.getByRole('status')).toContainText('Paso 1 de 1 · Pausada');
    await reloadedCard.getByRole('button', { name: 'Reanudar' }).click();
    await reloadedCard.getByRole('button', { name: 'Finalizar' }).click();
    await expect(reloadedCard.getByRole('status')).toContainText('Terminada');

    const sessionId = await findSessionId();
    const persisted = await pool.query<{ status: string; current_step: number }>(
      `select status, current_step from public.cooking_sessions where id = $1`,
      [sessionId]
    );
    expect(persisted.rows[0]).toEqual({ status: 'completed', current_step: 1 });
    const events = await pool.query<{ count: string }>(
      `select count(*)::text as count from public.cooking_session_events where session_id = $1`,
      [sessionId]
    );
    expect(events.rows[0]?.count).toBe('4');

    const completeEvent = await pool.query<{ idempotency_key: string }>(
      `select idempotency_key from public.cooking_session_events where session_id = $1 and operation_type = 'complete'`,
      [sessionId]
    );
    const replay = await page.request.patch(`/api/cooking-sessions/${sessionId}`, {
      data: {
        action: 'complete',
        expectedVersion: 3,
        idempotencyKey: completeEvent.rows[0].idempotency_key,
        confirmed: true,
      },
    });
    expect(replay.status()).toBe(200);
    const replayPayload = (await replay.json()) as SessionResponse;
    expect(replayPayload.status).toBe('already_applied');

    const businessCounts = await pool.query<{ inventory: string; movements: string }>(
      `select
         (select count(*)::text from public.recipe_inventory_items where tenant_id = $1) as inventory,
         (select count(*)::text from public.inventory_movements where tenant_id = $1) as movements`,
      [fixture.tenantId]
    );
    const consumption = await pool.query<{ consumption_payload: unknown }>(
      `select consumption_payload from public.user_meal_plans where id = $1`,
      [fixture.planId]
    );
    expect(businessCounts.rows[0]).toEqual({ inventory: '0', movements: '0' });
    expect(consumption.rows[0]?.consumption_payload).toEqual({});
  });

  test('rejects foreign access, cancellation, and a stale source conflict', async ({ page }) => {
    if (!fixture) throw new Error('Fixture not seeded.');
    await authenticateFixture(page);
    const foreignResponse = await page.request.get(
      `/api/cooking-sessions/${fixture.foreignSessionId}`
    );
    expect(foreignResponse.status()).toBe(404);

    const mealPlanResponse = await page.request.get('/api/meal-plan');
    expect(mealPlanResponse.ok()).toBeTruthy();
    const mealPlanPayload = (await mealPlanResponse.json()) as {
      id?: string;
      updatedAt?: string;
      plan?: Record<string, unknown> | null;
    };
    expect(mealPlanPayload.id).toBe(fixture.planId);
    if (!mealPlanPayload.updatedAt || !mealPlanPayload.plan) {
      throw new Error('The authenticated meal plan source was not available.');
    }
    fixture.updatedAt = mealPlanPayload.updatedAt;
    fixture.calendarPayload = mealPlanPayload.plan;

    const cancelStart = await page.request.post('/api/cooking-sessions', {
      data: {
        mealPlanId: fixture.planId,
        dayIndex: 2,
        mealType: 'dinner',
        recipeId: fixture.recipeId,
        versionId: fixture.versionId,
        expectedUpdatedAt: fixture.updatedAt,
        expectedCalendarPayload: fixture.calendarPayload,
        idempotencyKey: `cancel-start-${runId}`,
        confirmed: true,
      },
    });
    const cancelStartText = await cancelStart.text();
    expect(cancelStart.status(), cancelStartText).toBe(201);
    const cancelStartPayload = JSON.parse(cancelStartText) as SessionResponse;
    if (!cancelStartPayload.session) throw new Error('Cancellation session was not created.');
    const cancelSession = cancelStartPayload.session;
    const cancelResponse = await page.request.patch(`/api/cooking-sessions/${cancelSession.id}`, {
      data: {
        action: 'cancel',
        expectedVersion: cancelSession.version,
        idempotencyKey: `cancel-${runId}`,
        confirmed: true,
      },
    });
    expect(cancelResponse.status()).toBe(200);
    const cancelPayload = (await cancelResponse.json()) as SessionResponse;
    expect(cancelPayload.session?.status).toBe('cancelled');

    const conflictStart = await page.request.post('/api/cooking-sessions', {
      data: {
        mealPlanId: fixture.planId,
        dayIndex: 3,
        mealType: 'breakfast',
        recipeId: fixture.recipeId,
        versionId: fixture.versionId,
        expectedUpdatedAt: fixture.updatedAt,
        expectedCalendarPayload: fixture.calendarPayload,
        idempotencyKey: `conflict-start-${runId}`,
        confirmed: true,
      },
    });
    expect(conflictStart.status()).toBe(201);
    const conflictStartPayload = (await conflictStart.json()) as SessionResponse;
    if (!conflictStartPayload.session) throw new Error('Conflict session was not created.');
    const conflictSession = conflictStartPayload.session;
    await pool.query(
      `update public.user_meal_plans set calendar_payload = jsonb_set(calendar_payload, '{availableTimeMinutesSnapshot}', '45'::jsonb) where id = $1`,
      [fixture.planId]
    );
    const conflictResponse = await page.request.patch(
      `/api/cooking-sessions/${conflictSession.id}`,
      {
        data: {
          action: 'pause',
          expectedVersion: conflictSession.version,
          idempotencyKey: `conflict-pause-${runId}`,
          confirmed: true,
        },
      }
    );
    expect(conflictResponse.status()).toBe(409);
    const conflictPayload = (await conflictResponse.json()) as SessionResponse;
    expect(conflictPayload.code).toBe('COOKING_SESSION_SOURCE_CONFLICT');
  });
});
