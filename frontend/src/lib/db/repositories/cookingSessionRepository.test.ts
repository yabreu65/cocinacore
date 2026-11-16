import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueryResultRow } from 'pg';
import type { DbTransactionClient } from '@/lib/db/transaction-client';
import type { CookingSessionRow } from '@/lib/db/types';

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('@/lib/db', () => ({ transaction: mocks.transaction }));
import {
  createCookingSession,
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
function fixture(updatedAt = raw, priorHash?: string) {
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
          calendar_payload: calendar,
          period: 'week',
          people_count: 2,
          updated_at: updatedAt,
        },
      ];
    else if (sql.includes('from public.user_recipes')) rows = [{ id: recipeId }];
    else if (sql.includes('from public.user_recipe_versions'))
      rows = [
        {
          id: versionId,
          title: 'Arroz',
          instructions: 'Cocinar el arroz.',
          servings: 2,
          ingredients: [{ name: 'Arroz', quantity: 1, unit: 'kg' }],
        },
      ];
    else if (
      sql.includes('insert into public.cooking_sessions') ||
      sql.includes('from public.cooking_sessions where id')
    )
      rows = [session];
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
  it('revalidates the exact session source without truncating microseconds', async () => {
    expect(await revalidateCookingSessionSourceInTransaction(fixture().client, session)).toBe(true);
    expect(
      await revalidateCookingSessionSourceInTransaction(
        fixture('2026-11-14 12:00:00.123457+00').client,
        session
      )
    ).toBe(false);
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
    expect(f.queries[2]).toContain('from public.cooking_sessions');
  });
});
