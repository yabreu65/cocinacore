import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { transaction } from '@/lib/db';
import type {
  CookingSessionEventRow,
  CookingSessionRow,
  UserMealPlanRow,
  UserRecipeVersionRow,
} from '@/lib/db/types';
import {
  createInstructionSnapshot,
  transitionCookingSession as transitionCookingSessionState,
  type CookingSessionAction,
  type CookingInstructionSnapshot,
} from '@/lib/cooking-session';
import {
  parseStructuredMealPlanValue,
  type StructuredMealType,
} from '@/lib/meal-planner/structured-plan';

export interface CreateCookingSessionInput {
  tenantId: string;
  userId: string;
  mealPlanId: string;
  dayIndex: number;
  mealType: StructuredMealType;
  recipeId: string;
  versionId: string;
  expectedUpdatedAt: string;
  expectedCalendarPayload: unknown;
  idempotencyKey: string;
}

export interface TransitionCookingSessionInput {
  tenantId: string;
  userId: string;
  sessionId: string;
  action: CookingSessionAction;
  expectedVersion: number;
  idempotencyKey: string;
}

export type CookingSessionOperationResult =
  | {
      status: 'applied' | 'already_applied';
      session: CookingSessionRow;
      event: CookingSessionEventRow | null;
    }
  | {
      status:
        | 'not_found'
        | 'conflict'
        | 'source_conflict'
        | 'invalid_plan'
        | 'invalid_transition'
        | 'step_boundary';
    };

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

function hashPayload(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

async function setRlsContext(client: PoolClient, tenantId: string, userId: string) {
  await client.query(
    "select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)",
    [tenantId, userId]
  );
}

async function lockPlan(
  client: PoolClient,
  input: CreateCookingSessionInput
): Promise<UserMealPlanRow | null> {
  const result = await client.query<UserMealPlanRow>(
    `select * from public.user_meal_plans
     where id = $1 and tenant_id = $2 and user_id = $3
     for update`,
    [input.mealPlanId, input.tenantId, input.userId]
  );
  return result.rows[0] ?? null;
}

async function validateSource(
  client: PoolClient,
  input: CreateCookingSessionInput,
  plan: UserMealPlanRow
): Promise<
  | { status: 'ok'; version: UserRecipeVersionRow; snapshot: CookingInstructionSnapshot }
  | { status: 'invalid_plan' | 'source_conflict' }
> {
  const parsed = parseStructuredMealPlanValue(plan.calendar_payload, plan.period);
  if (!parsed.success || !parsed.plan.schedule?.portionConfirmation)
    return { status: 'invalid_plan' };
  if (parsed.plan.schedule.portionConfirmation.peopleCount !== plan.people_count)
    return { status: 'source_conflict' };
  if (
    plan.updated_at !== input.expectedUpdatedAt ||
    stableJson(plan.calendar_payload) !== stableJson(input.expectedCalendarPayload)
  ) {
    return { status: 'source_conflict' };
  }
  const day = parsed.plan.days.find((candidate) => candidate.dayIndex === input.dayIndex);
  const meal = day?.meals.find((candidate) => candidate.mealType === input.mealType);
  if (
    !meal?.recipeRef ||
    meal.recipeRef.recipeId !== input.recipeId ||
    meal.recipeRef.versionId !== input.versionId
  ) {
    return { status: 'source_conflict' };
  }
  const recipe = await client.query<{ id: string }>(
    `select id from public.user_recipes
     where id = $1 and tenant_id = $2 and user_id = $3 and archived_at is null`,
    [input.recipeId, input.tenantId, input.userId]
  );
  if (!recipe.rows[0]) return { status: 'source_conflict' };
  const version = await client.query<UserRecipeVersionRow>(
    `select * from public.user_recipe_versions
     where id = $1 and recipe_id = $2 and tenant_id = $3 and user_id = $4`,
    [input.versionId, input.recipeId, input.tenantId, input.userId]
  );
  const recipeVersion = version.rows[0];
  if (!recipeVersion) return { status: 'source_conflict' };
  const snapshot = createInstructionSnapshot(
    input.recipeId,
    input.versionId,
    recipeVersion.title,
    recipeVersion.instructions,
    recipeVersion.servings,
    recipeVersion.ingredients
  );
  if (!snapshot) return { status: 'source_conflict' };
  return { status: 'ok', version: recipeVersion, snapshot };
}

async function existingIdempotentSession(
  client: PoolClient,
  tenantId: string,
  userId: string,
  idempotencyKey: string,
  payloadHash: string
): Promise<CookingSessionOperationResult | null> {
  const result = await client.query<CookingSessionRow & { event_payload_hash: string }>(
    `select session.*, event.payload_hash as event_payload_hash
     from public.cooking_sessions session
     join public.cooking_session_events event on event.session_id = session.id
       and event.tenant_id = session.tenant_id and event.user_id = session.user_id
     where session.tenant_id = $1 and session.user_id = $2 and event.idempotency_key = $3
     for update of session`,
    [tenantId, userId, idempotencyKey]
  );
  const row = result.rows[0];
  if (!row) return null;
  if (row.event_payload_hash !== payloadHash) return { status: 'conflict' };
  return { status: 'already_applied', session: row, event: null };
}

export async function createCookingSession(
  input: CreateCookingSessionInput
): Promise<CookingSessionOperationResult> {
  const payloadHash = hashPayload({ operation: 'start', ...input });
  return transaction(async (client): Promise<CookingSessionOperationResult> => {
    await setRlsContext(client, input.tenantId, input.userId);
    const prior = await existingIdempotentSession(
      client,
      input.tenantId,
      input.userId,
      input.idempotencyKey,
      payloadHash
    );
    if (prior) return prior;
    const plan = await lockPlan(client, input);
    if (!plan) return { status: 'not_found' };
    const source = await validateSource(client, input, plan);
    if (source.status !== 'ok') return source;
    const open = await client.query<CookingSessionRow>(
      `select * from public.cooking_sessions
       where tenant_id = $1 and user_id = $2 and meal_plan_id = $3 and day_index = $4 and meal_type = $5
         and status in ('active', 'paused')
       for update`,
      [input.tenantId, input.userId, input.mealPlanId, input.dayIndex, input.mealType]
    );
    if (open.rows[0]) return { status: 'conflict' };
    const sourceHash = hashPayload(plan.calendar_payload);
    const inserted = await client.query<CookingSessionRow>(
      `insert into public.cooking_sessions
       (tenant_id, user_id, meal_plan_id, day_index, meal_type, recipe_id, recipe_version_id,
        status, current_step, total_steps, instruction_snapshot, source_updated_at, source_calendar_payload_hash)
       values ($1, $2, $3, $4, $5, $6, $7, 'active', 1, $8, $9::jsonb, $10, $11)
       returning *`,
      [
        input.tenantId,
        input.userId,
        input.mealPlanId,
        input.dayIndex,
        input.mealType,
        input.recipeId,
        input.versionId,
        source.snapshot.steps.length,
        JSON.stringify(source.snapshot),
        plan.updated_at,
        sourceHash,
      ]
    );
    const session = inserted.rows[0];
    if (!session) return { status: 'conflict' };
    const eventResult = await client.query<CookingSessionEventRow>(
      `insert into public.cooking_session_events
       (session_id, tenant_id, user_id, operation_type, previous_step, next_step,
        previous_status, next_status, idempotency_key, payload_hash)
       values ($1, $2, $3, 'start', 1, 1, 'active', 'active', $4, $5)
       returning *`,
      [session.id, input.tenantId, input.userId, input.idempotencyKey, payloadHash]
    );
    return { status: 'applied', session, event: eventResult.rows[0] ?? null };
  }).catch((error: unknown) => {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error.code === '23505' || error.code === '40001' || error.code === '40P01')
    ) {
      return { status: 'conflict' as const };
    }
    throw error;
  });
}

async function loadSession(
  client: PoolClient,
  tenantId: string,
  userId: string,
  sessionId: string
) {
  const result = await client.query<CookingSessionRow>(
    `select * from public.cooking_sessions where id = $1 and tenant_id = $2 and user_id = $3 for update`,
    [sessionId, tenantId, userId]
  );
  return result.rows[0] ?? null;
}

async function revalidateSessionSource(
  client: PoolClient,
  session: CookingSessionRow
): Promise<boolean> {
  const plan = await client.query<UserMealPlanRow>(
    `select * from public.user_meal_plans
     where id = $1 and tenant_id = $2 and user_id = $3
     for share`,
    [session.meal_plan_id, session.tenant_id, session.user_id]
  );
  const currentPlan = plan.rows[0];
  if (!currentPlan || currentPlan.updated_at !== session.source_updated_at) return false;
  if (hashPayload(currentPlan.calendar_payload) !== session.source_calendar_payload_hash)
    return false;
  const parsed = parseStructuredMealPlanValue(currentPlan.calendar_payload, currentPlan.period);
  if (!parsed.success || !parsed.plan.schedule?.portionConfirmation) return false;
  if (parsed.plan.schedule.portionConfirmation.peopleCount !== currentPlan.people_count)
    return false;
  const day = parsed.plan.days.find((candidate) => candidate.dayIndex === session.day_index);
  const meal = day?.meals.find((candidate) => candidate.mealType === session.meal_type);
  if (
    !meal?.recipeRef ||
    meal.recipeRef.recipeId !== session.recipe_id ||
    meal.recipeRef.versionId !== session.recipe_version_id
  )
    return false;
  const recipe = await client.query<{ id: string }>(
    `select id from public.user_recipes
     where id = $1 and tenant_id = $2 and user_id = $3 and archived_at is null`,
    [session.recipe_id, session.tenant_id, session.user_id]
  );
  if (!recipe.rows[0]) return false;
  const version = await client.query<{ id: string }>(
    `select id from public.user_recipe_versions
     where id = $1 and recipe_id = $2 and tenant_id = $3 and user_id = $4`,
    [session.recipe_version_id, session.recipe_id, session.tenant_id, session.user_id]
  );
  return Boolean(version.rows[0]);
}

export async function getCookingSession(
  sessionId: string,
  tenantId: string,
  userId: string
): Promise<CookingSessionRow | null> {
  return transaction(async (client) => {
    await setRlsContext(client, tenantId, userId);
    const result = await client.query<CookingSessionRow>(
      `select * from public.cooking_sessions where id = $1 and tenant_id = $2 and user_id = $3`,
      [sessionId, tenantId, userId]
    );
    return result.rows[0] ?? null;
  });
}

export async function transitionCookingSessionInTransaction(
  client: PoolClient,
  input: TransitionCookingSessionInput
): Promise<CookingSessionOperationResult> {
  const session = await loadSession(client, input.tenantId, input.userId, input.sessionId);
  if (!session) return { status: 'not_found' };
  const payloadHash = hashPayload({ action: input.action, expectedVersion: input.expectedVersion });
  const prior = await client.query<CookingSessionEventRow>(
    `select * from public.cooking_session_events where session_id = $1 and idempotency_key = $2`,
    [session.id, input.idempotencyKey]
  );
  if (prior.rows[0]) {
    if (prior.rows[0].payload_hash !== payloadHash) return { status: 'conflict' };
    return { status: 'already_applied', session, event: prior.rows[0] };
  }
  if (session.version !== input.expectedVersion) return { status: 'conflict' };
  if (!(await revalidateSessionSource(client, session))) return { status: 'source_conflict' };
  const result = transitionCookingSessionState(
    {
      status: session.status,
      currentStep: session.current_step,
      totalSteps: session.total_steps,
      version: session.version,
    },
    input.action
  );
  if (!result.ok) {
    return { status: result.reason === 'session_closed' ? 'invalid_transition' : result.reason };
  }
  const updated = await client.query<CookingSessionRow>(
    `update public.cooking_sessions
     set status = $1, current_step = $2, version = version + 1,
         updated_at = now(),
         completed_at = case when $1 = 'completed' then now() else completed_at end,
         cancelled_at = case when $1 = 'cancelled' then now() else cancelled_at end,
         retention_until = case when $1 = 'completed' then now() + interval '365 days'
                                when $1 = 'cancelled' then now() + interval '90 days'
                                else retention_until end
     where id = $3 and tenant_id = $4 and user_id = $5 and version = $6
     returning *`,
    [
      result.status,
      result.currentStep,
      session.id,
      input.tenantId,
      input.userId,
      input.expectedVersion,
    ]
  );
  const next = updated.rows[0];
  if (!next) return { status: 'conflict' };
  const event = await client.query<CookingSessionEventRow>(
    `insert into public.cooking_session_events
     (session_id, tenant_id, user_id, operation_type, previous_step, next_step,
      previous_status, next_status, idempotency_key, payload_hash)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     returning *`,
    [
      session.id,
      input.tenantId,
      input.userId,
      input.action,
      session.current_step,
      next.current_step,
      session.status,
      next.status,
      input.idempotencyKey,
      payloadHash,
    ]
  );
  return { status: 'applied', session: next, event: event.rows[0] ?? null };
}

export async function transitionCookingSession(
  input: TransitionCookingSessionInput
): Promise<CookingSessionOperationResult> {
  return transaction(async (client) => {
    await setRlsContext(client, input.tenantId, input.userId);
    return transitionCookingSessionInTransaction(client, input);
  }).catch((error: unknown) => {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error.code === '23505' || error.code === '40001' || error.code === '40P01')
    ) {
      return { status: 'conflict' as const };
    }
    throw error;
  });
}
