import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPool } from '@/lib/db';
import { createCookingSession, transitionCookingSession } from './cookingSessionRepository';

const enabled = process.env.RUN_M5_U3_DB_INTEGRATION === '1';
const suite = enabled ? describe : describe.skip;

function planPayload(recipeId: string, versionId: string) {
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
      meals: ['breakfast', 'lunch', 'dinner'].map((mealType) => ({
        mealType,
        title: 'Fixture meal',
        prepMinutes: 20,
        description: null,
        ingredients: [{ name: 'Rice', quantity: 1, unit: 'cup' }],
        ...(index === 0 && mealType === 'lunch' ? { recipeRef: { recipeId, versionId } } : {}),
      })),
    })),
  };
}

suite('cookingSessionRepository PostgreSQL integration', () => {
  let admin: Pool;
  let fixture: {
    tenantId: string;
    userId: string;
    recipeId: string;
    versionId: string;
    planId: string;
  };
  let input: Parameters<typeof createCookingSession>[0];
  let sessionId: string;

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_URL });
    const tenantId = randomUUID();
    const userId = randomUUID();
    const recipeId = randomUUID();
    const versionId = randomUUID();
    const planId = randomUUID();
    await admin.query(
      `insert into public.tenants (id, tenant_type, name) values ($1, 'home', 'U3 integration')`,
      [tenantId]
    );
    await admin.query(
      `insert into public.users (id, email, password_hash, email_confirmed, full_name, tenant_id, role, terms_accepted_at, terms_version, onboarding_completed)
       values ($1, $2, 'fixture', true, 'U3 integration', $3, 'owner', now(), 'v1', true)`,
      [userId, `u3-integration-${process.pid}@cocinacore.local`, tenantId]
    );
    await admin.query(
      `insert into public.tenant_memberships (tenant_id, user_id, role) values ($1, $2, 'owner')`,
      [tenantId, userId]
    );
    await admin.query(
      `insert into public.user_recipes (id, tenant_id, user_id, category) values ($1, $2, $3, 'u3')`,
      [recipeId, tenantId, userId]
    );
    await admin.query(
      `insert into public.user_recipe_versions (id, recipe_id, tenant_id, user_id, version_number, title, instructions, servings, ingredients)
       values ($1, $2, $3, $4, 1, 'Guided fixture', 'Mix the ingredients.', 2, $5::jsonb)`,
      [
        versionId,
        recipeId,
        tenantId,
        userId,
        JSON.stringify([{ name: 'Rice', quantity: 1, unit: 'cup' }]),
      ]
    );
    const payload = planPayload(recipeId, versionId);
    const plan = await admin.query<{ id: string; updated_at: string }>(
      `insert into public.user_meal_plans (id, tenant_id, user_id, people_count, period, mode, base_cuisine, calendar_payload)
       values ($1, $2, $3, 2, 'week', 'menu_to_shopping', 'u3', $4::jsonb) returning id, updated_at::text as updated_at`,
      [planId, tenantId, userId, JSON.stringify(payload)]
    );
    fixture = { tenantId, userId, recipeId, versionId, planId };
    input = {
      tenantId,
      userId,
      mealPlanId: planId,
      dayIndex: 1,
      mealType: 'lunch',
      recipeId,
      versionId,
      expectedUpdatedAt: plan.rows[0].updated_at,
      expectedCalendarPayload: payload,
      idempotencyKey: 'start-u3-integration',
    };
  });

  afterAll(async () => {
    if (fixture) {
      await admin.query('delete from public.cooking_session_events where tenant_id = $1', [
        fixture.tenantId,
      ]);
      await admin.query('delete from public.cooking_sessions where tenant_id = $1', [
        fixture.tenantId,
      ]);
      await admin.query('delete from public.user_meal_plans where id = $1', [fixture.planId]);
      await admin.query('delete from public.user_recipe_versions where id = $1', [
        fixture.versionId,
      ]);
      await admin.query('delete from public.user_recipes where id = $1', [fixture.recipeId]);
      await admin.query('delete from public.users where id = $1', [fixture.userId]);
      await admin.query('delete from public.tenants where id = $1', [fixture.tenantId]);
    }
    await admin.end();
    await getPool().end();
  });

  it('creates an immutable snapshot and makes the start retry idempotent', async () => {
    const first = await createCookingSession(input);
    expect(first.status).toBe('applied');
    if (first.status !== 'applied') return;
    sessionId = first.session.id;
    expect(first.session.instruction_snapshot).toMatchObject({
      steps: [{ instruction: 'Mix the ingredients.' }],
    });
    const retry = await createCookingSession(input);
    expect(retry.status).toBe('already_applied');
  });

  it('serializes concurrent transitions and rejects a changed source', async () => {
    const results = await Promise.all([
      transitionCookingSession({
        tenantId: fixture.tenantId,
        userId: fixture.userId,
        sessionId,
        action: 'pause',
        expectedVersion: 1,
        idempotencyKey: 'pause-a',
      }),
      transitionCookingSession({
        tenantId: fixture.tenantId,
        userId: fixture.userId,
        sessionId,
        action: 'pause',
        expectedVersion: 1,
        idempotencyKey: 'pause-b',
      }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['applied', 'conflict']);
    const winning = results.find((result) => result.status === 'applied');
    if (!winning || winning.status !== 'applied') throw new Error('Missing winning transition.');
    const retry = await transitionCookingSession({
      tenantId: fixture.tenantId,
      userId: fixture.userId,
      sessionId,
      action: 'pause',
      expectedVersion: 1,
      idempotencyKey: winning.event?.idempotency_key ?? 'pause-a',
    });
    expect(retry.status).toBe('already_applied');
    await admin.query(
      `update public.user_meal_plans set calendar_payload = jsonb_set(calendar_payload, '{availableTimeMinutesSnapshot}', '45'::jsonb) where id = $1`,
      [fixture.planId]
    );
    const changed = await transitionCookingSession({
      tenantId: fixture.tenantId,
      userId: fixture.userId,
      sessionId,
      action: 'resume',
      expectedVersion: 2,
      idempotencyKey: 'resume-after-change',
    });
    expect(changed.status).toBe('source_conflict');

    const inventory = await admin.query<{ count: string }>(
      `select count(*)::text as count from public.recipe_inventory_items where tenant_id = $1`,
      [fixture.tenantId]
    );
    const movements = await admin.query<{ count: string }>(
      `select count(*)::text as count from public.inventory_movements where tenant_id = $1`,
      [fixture.tenantId]
    );
    const consumption = await admin.query<{ consumption_payload: unknown }>(
      `select consumption_payload from public.user_meal_plans where id = $1`,
      [fixture.planId]
    );
    expect(inventory.rows[0]?.count).toBe('0');
    expect(movements.rows[0]?.count).toBe('0');
    expect(consumption.rows[0]?.consumption_payload).toEqual({});
  });
});
