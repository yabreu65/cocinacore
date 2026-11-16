import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueryResultRow } from 'pg';
import type { DbTransactionClient } from '@/lib/db/transaction-client';
import type { CookingSessionRow } from '@/lib/db/types';
import { renderRecipeDisplay } from '@/lib/recipes/recipe-import';
import { parseStructuredMealPlanValue } from '@/lib/meal-planner/structured-plan';

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('@/lib/db', () => ({ transaction: mocks.transaction }));
import {
  createCookingSession,
  findCookingSessionForSlot,
  transitionCookingSessionInTransaction,
  revalidateCookingSessionSourceInTransaction,
} from './cookingSessionRepository';

const tenantId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const recipeId = '44444444-4444-4444-8444-444444444444';
const versionId = '55555555-5555-4555-8555-555555555555';
const mealPlanId = '66666666-6666-4666-8666-666666666666';
const sessionId = '77777777-7777-4777-8777-777777777777';
const raw = '2026-11-14 12:00:00.123456+00';
const iso = '2026-11-14T12:00:00.123456Z';
const calendar = {
  period: 'week',
  dayCount: 7,
  schedule: {
    startDate: '2026-11-14',
    timeZone: 'America/Bogota',
    confirmedAt: '2026-11-13T12:00:00.000Z',
    portionConfirmation: { peopleCount: 2, confirmedAt: '2026-11-13T12:00:00.000Z' },
  },
  days: Array.from({ length: 7 }, (_, i) => ({
    dayIndex: i + 1,
    label: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'][i],
    meals: ['breakfast', 'lunch', 'dinner'].map((mealType) => ({
      mealType,
      title: 'Arroz',
      prepMinutes: 20,
      description: null,
      ingredients: [{ name: 'Arroz', quantity: 1, unit: 'kg' }],
      ...(i === 0 && mealType === 'lunch' ? { recipeRef: { recipeId, versionId } } : {}),
    })),
  })),
};
function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + stable(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
const hash = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex');
const input = {
  tenantId,
  userId,
  mealPlanId,
  recipeId,
  versionId,
  dayIndex: 1,
  mealType: 'lunch' as const,
  expectedUpdatedAt: iso,
  expectedCalendarPayload: calendar,
  idempotencyKey: 'start',
};
const session: CookingSessionRow = {
  id: sessionId,
  tenant_id: tenantId,
  user_id: userId,
  meal_plan_id: mealPlanId,
  day_index: 1,
  meal_type: 'lunch',
  recipe_id: recipeId,
  recipe_version_id: versionId,
  status: 'active',
  current_step: 1,
  total_steps: 1,
  instruction_snapshot: {},
  source_updated_at: iso,
  source_calendar_payload_hash: hash(calendar),
  version: 1,
  started_at: raw,
  updated_at: raw,
  completed_at: null,
  cancelled_at: null,
  retention_until: null,
};
function fixture(updatedAt = raw, priorHash?: string, allergies: string[] = [], instructions = 'Cocinar el arroz.', evaluated: string[] = [], history?: Record<string, unknown>, planCalendar: unknown = calendar) {
  const queries: string[] = [];
  const params: unknown[][] = [];
  const query: DbTransactionClient['query'] = async <Row extends QueryResultRow>(
    sql: string,
    values: unknown[] = []
  ): Promise<{ rows: Row[] }> => {
    queries.push(sql);
    params.push(values);
    let rows: QueryResultRow[] = [];
    if (sql.includes('join public.cooking_session_events') && priorHash)
      rows = [{ ...session, event_payload_hash: priorHash }];
    else if (sql.includes('from public.user_meal_plans'))
      rows = [
        {
          id: mealPlanId,
          calendar_payload: planCalendar,
          period: 'week',
          people_count: 2,
          restrictions: [], inventory_snapshot: { evaluatedHardRestrictions: evaluated },
          updated_at: updatedAt,
        },
      ];
    else if (sql.includes('from public.user_culinary_profiles')) rows = [{ user_id: userId, tenant_id: tenantId, allergies }];
    else if (sql.includes('from public.recipe_ai_history')) rows = history ? [history] : [];
    else if (sql.includes('from public.user_recipes')) rows = [{ id: recipeId }];
    else if (sql.includes('from public.user_recipe_versions'))
      rows = [
        {
          id: versionId,
          title: 'Arroz',
          instructions,
          servings: 2,
          ingredients: [{ name: 'Arroz', quantity: '1', unit: 'kg' }],
          source_recipe_history_id: history?.id ?? null,
        },
      ];
    else if (
      sql.includes('insert into public.cooking_sessions') ||
      sql.includes('from public.cooking_sessions where id')
    )
      rows = [session];
    else if (sql.includes('from public.cooking_sessions') && sql.includes('recipe_version_id = $7')) rows = [session];
    else if (sql.includes('update public.cooking_sessions'))
      rows = [{ ...session, status: 'paused', version: 2 }];
    else if (sql.includes('insert into public.cooking_session_events')) rows = [{ id: 'event-1' }];
    return { rows: rows as Row[] };
  };
  const client = { query };
  mocks.transaction.mockImplementation(
    async (callback: (client: DbTransactionClient) => Promise<unknown>, options: unknown) => {
      if (options !== undefined) expect(options).toEqual({ isolationLevel: 'read committed' });
      return callback(client);
    }
  );
  return { client, queries, params };
}
describe('cooking session exact revision and lock ordering', () => {
  beforeEach(() => {
    mocks.transaction.mockReset();
  });
  it('accepts equivalent PostgreSQL and ISO revisions and locks tenant before plan or session reads', async () => {
    const f = fixture();
    expect(await createCookingSession(input)).toMatchObject({ status: 'applied' });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'read committed',
    });
    expect(f.queries[0]).toContain('set_config');
    expect(f.queries[1]).toContain('pg_advisory_xact_lock');
    expect(f.params[1]).toEqual(['cocinacore:inventory-source:v1:' + tenantId]);
    expect(f.queries[2]).toContain('join public.cooking_session_events');
  });
  it('rejects a one-microsecond change before inserting a session', async () => {
    const f = fixture('2026-11-14 12:00:00.123457+00');
    expect(await createCookingSession(input)).toEqual({ status: 'source_conflict' });
    expect(f.queries.some((sql) => sql.includes('insert into'))).toBe(false);
  });
  it('preserves exact historical idempotency hashes and rejects contradictory replay', async () => {
    const legacy = { ...input, expectedUpdatedAt: raw };
    const f = fixture(raw, hash({ operation: 'start', ...legacy }));
    expect(await createCookingSession(legacy)).toMatchObject({ status: 'already_applied' });
    expect(await createCookingSession({ ...legacy, dayIndex: 2 })).toEqual({ status: 'conflict' });
    expect(f.queries.some((sql) => sql.includes('insert into'))).toBe(false);
  });
  it('accepts a changed row revision with unchanged calendar but rejects a changed source hash', async () => {
    expect(await revalidateCookingSessionSourceInTransaction(fixture().client, session)).toBe(true);
    expect(
      await revalidateCookingSessionSourceInTransaction(
        fixture('2026-11-14 12:00:00.123457+00').client,
        session
      )
    ).toBe(true);
    expect(await revalidateCookingSessionSourceInTransaction(fixture(raw, undefined, [], undefined, [], undefined, { ...calendar, availableTimeMinutesSnapshot: 45 }).client, session)).toBe(false);
  });
  it('takes the tenant lock before session row lock on transitions', async () => {
    const f = fixture();
    expect(
      await transitionCookingSessionInTransaction(f.client, {
        tenantId,
        userId,
        sessionId,
        action: 'pause',
        expectedVersion: 1,
        idempotencyKey: 'pause',
      })
    ).toMatchObject({ status: 'applied' });
    expect(f.queries[0]).toContain('set_config');
    expect(f.queries[1]).toContain('pg_advisory_xact_lock');
    expect(f.params[2]).toEqual(['culinary-profile:' + tenantId + ':' + userId]);
    expect(f.queries[3]).toContain('from public.cooking_sessions');
  });
  it('blocks starting or resuming a session with a newly added unevaluated allergy', async () => {
    const f = fixture(raw, undefined, ['new allergy']);
    expect(await createCookingSession(input)).toEqual({ status: 'restrictions_changed' });
    expect(f.queries.some((sql) => sql.includes('insert into public.cooking_sessions'))).toBe(false);
    expect(await transitionCookingSessionInTransaction(f.client, {
      tenantId, userId, sessionId, action: 'resume', expectedVersion: 1, idempotencyKey: 'resume',
    })).toEqual({ status: 'restrictions_changed' });
    expect(f.queries.some((sql) => sql.includes('update public.cooking_sessions'))).toBe(false);
  });

  it('blocks a conflict hidden in the pinned instructions even under an evaluated menu', async () => {
    const f = fixture(raw, undefined, ['Maní'], 'Añadir maní.', ['Maní']);
    expect(await createCookingSession(input)).toEqual({ status: 'restrictions_changed' });
    expect(f.queries.some((sql) => sql.includes('insert into public.cooking_sessions'))).toBe(false);
  });

  it('allows pausing a session after a profile change', async () => {
    const f = fixture(raw, undefined, ['new allergy']);
    expect(await transitionCookingSessionInTransaction(f.client, {
      tenantId, userId, sessionId, action: 'pause', expectedVersion: 1, idempotencyKey: 'pause',
    })).toMatchObject({ status: 'applied' });
  });

  it('accepts only the unmodified generated version evaluated under all current restrictions', async () => {
    const id = '88888888-8888-4888-8888-888888888888';
    const preparation = 'Cocinar el arroz.';
    const ingredients = [{ name: 'Arroz', quantity: '1', unit: 'kg' }];
    const history = {
      id, user_id: userId, tenant_id: tenantId, source: 'gemini', recipe_title: 'Arroz',
      restrictions_snapshot: { allergies: ['Maní'], avoid: [] },
      recipe_payload: { provider: 'gemini', recipeReviewRequired: true, preparation,
        title: 'Arroz', peopleCount: 2, full_recipe: renderRecipeDisplay('Arroz', ingredients, preparation),
        structuredIngredients: [{ name: 'Arroz', quantity: 1, unit: 'kg' }] },
    };
    fixture(raw, undefined, ['Maní'], preparation, ['Maní'], history);
    expect(await createCookingSession(input)).toMatchObject({ status: 'applied' });
    fixture(raw, undefined, ['Maní'], 'Añadir otra salsa.', ['Maní'], history);
    expect(await createCookingSession(input)).toEqual({ status: 'restrictions_changed' });
    fixture(raw, undefined, ['Maní'], preparation, ['Maní'], { ...history, restrictions_snapshot: { allergies: [], avoid: [] } });
    expect(await createCookingSession(input)).toEqual({ status: 'restrictions_changed' });
  });

  it('scopes recovery by plan, day, meal, recipe and version, excluding cancelled sessions', async () => {
    const f = fixture();
    expect(await findCookingSessionForSlot({ ...input })).toEqual(session);
    const index = f.queries.findIndex((sql) => sql.includes('recipe_version_id = $7'));
    expect(f.params[index]).toEqual([tenantId, userId, mealPlanId, 1, 'lunch', recipeId, versionId]);
    expect(f.queries[index]).toContain("status in ('active', 'paused', 'completed')");
  });
  it('allows explicit cancellation of a session even when its calendar has changed', async () => {
    const f = fixture(raw, undefined, [], undefined, [], undefined, { ...calendar, availableTimeMinutesSnapshot: 45 });
    expect(await transitionCookingSessionInTransaction(f.client, {
      tenantId, userId, sessionId, action: 'cancel', expectedVersion: 1, idempotencyKey: 'cancel',
    })).toMatchObject({ status: 'applied' });
    expect(f.queries.some((sql) => sql.includes('from public.user_meal_plans'))).toBe(false);
  });

  it('starts from an unchanged historical calendar returned in canonical form by GET', async () => {
    const historical = {
      ...calendar,
      days: calendar.days.map((day, index) => ({
        ...Object.fromEntries(Object.entries(day).filter(([key]) => key !== 'label')),
        meals: (index === 0 ? [...day.meals].reverse() : day.meals).map((meal) =>
          Object.fromEntries(Object.entries(meal).filter(([key]) => key !== 'prepMinutes'))),
      })),
    };
    const canonical = parseStructuredMealPlanValue(historical, 'week');
    expect(canonical.success).toBe(true);
    if (!canonical.success) throw new Error('Expected valid historical fixture');
    expect(canonical.plan.days[0].meals[0].prepMinutes).toBeNull();
    expect(canonical.plan).not.toEqual(historical);
    const f = fixture(raw, undefined, [], undefined, [], undefined, historical);
    expect(await createCookingSession({ ...input, expectedCalendarPayload: canonical.plan })).toMatchObject({ status: 'applied' });
    const inserted = f.queries.findIndex((sql) => sql.includes('insert into public.cooking_sessions'));
    expect(f.params[inserted]).toContain(hash(historical));
    const stale = fixture('2026-11-14 12:00:00.123457+00', undefined, [], undefined, [], undefined, historical);
    expect(await createCookingSession({ ...input, expectedCalendarPayload: canonical.plan })).toEqual({ status: 'source_conflict' });
    expect(stale.queries.some((sql) => sql.includes('insert into public.cooking_sessions'))).toBe(false);
  });
  it('rejects modified or invalid client calendar evidence at the same revision', async () => {
    const changed = {
      ...calendar, days: calendar.days.map((day, index) => index === 0 ? {
        ...day, meals: day.meals.map((meal) => meal.mealType === 'lunch' ? { ...meal, title: 'Different lunch' } : meal),
      } : day),
    };
    const f = fixture();
    expect(await createCookingSession({ ...input, expectedCalendarPayload: changed })).toEqual({ status: 'source_conflict' });
    expect(await createCookingSession({ ...input, expectedCalendarPayload: { period: 'week', days: [] } })).toEqual({ status: 'source_conflict' });
    expect(f.queries.some((sql) => sql.includes('insert into public.cooking_sessions'))).toBe(false);
  });

});
