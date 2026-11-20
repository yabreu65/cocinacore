import { isDeepStrictEqual } from 'node:util';
import type { DbTransactionClient } from '@/lib/db/transaction-client';
import { readHardRestrictionList } from '@/lib/profile/culinary-profile-contract';
import { lockInventorySourceTenant } from '@/lib/db/inventory-source-lock';
import { equalPostgresTimestamps } from '@/lib/db/postgres-timestamp';
import { mapSingleRow, scopedTransaction, type AuthenticatedDbScope } from '@/lib/db';
import {
  lockCulinaryProfileUpdateInTransaction,
  findCulinaryProfileByUserIdInTransaction,
  findCulinaryProfileTermsByUserIdInTransaction,
} from './culinaryProfileRepository';
import type {
  FusionIntensity,
  MealPlanMode,
  MealPlanPeriod,
  UserMealPlanRow,
} from '@/lib/db/types';
import {
  getLocalDateInTimeZone,
  hasRestrictedMealPlanContent,
  mealPlanRestrictionsChanged,
  parseStructuredMealPlanSchedule,
  parseStructuredMealPlanValue,
  renderStructuredMealPlan,
  type StructuredMealPlan,
  type StructuredMealType,
  type StructuredMealPlanSchedule,
} from '@/lib/meal-planner/structured-plan';

export class MealPlanRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MealPlanRepositoryError';
  }
}

export type AttachRecipeToMealPlanSlotResult =
  | {
      status: 'applied' | 'already_applied';
      mealPlan: UserMealPlanRow;
      recipeId: string;
      versionId: string;
    }
  | {
      status:
        | 'not_found'
        | 'recipe_not_found'
        | 'version_not_found'
        | 'invalid_plan'
        | 'slot_not_found'
        | 'schedule_not_confirmed'
        | 'conflict';
    };

export interface AttachRecipeToMealPlanSlotInput {
  mealPlanId: string;
  userId: string;
  tenantId: string;
  dayIndex: number;
  mealType: StructuredMealType;
  recipeId: string;
  versionId: string;
  expectedUpdatedAt: string;
  expectedCalendarPayload: unknown;
}

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function attachRecipeReference(
  payload: unknown,
  dayIndex: number,
  mealType: StructuredMealType,
  recipeId: string,
  versionId: string
): unknown | null {
  if (!isJsonRecord(payload) || !Array.isArray(payload.days)) return null;
  const days = (payload.days as unknown[]).map((day: unknown) => {
    if (!isJsonRecord(day) || day.dayIndex !== dayIndex || !Array.isArray(day.meals)) return day;
    const meals = (day.meals as unknown[]).map((meal: unknown) => {
      if (!isJsonRecord(meal) || meal.mealType !== mealType) return meal;
      return { ...meal, recipeRef: { recipeId, versionId } };
    });
    return { ...day, meals };
  });
  return { ...payload, days };
}

/** Attaches an exact saved recipe version to one confirmed plan slot atomically. */
export async function attachRecipeToMealPlanSlot(
  input: AttachRecipeToMealPlanSlotInput
): Promise<AttachRecipeToMealPlanSlotResult> {
  return scopedTransaction({ tenantId: input.tenantId, userId: input.userId }, async (client) => {
    await lockInventorySourceTenant(client, input.tenantId);
    const currentResult = await client.query<UserMealPlanRow>(
      `select * from public.user_meal_plans
       where id = $1 and tenant_id = $2 and user_id = $3
       for update`,
      [input.mealPlanId, input.tenantId, input.userId]
    );
    const current = currentResult.rows[0];
    if (!current) return { status: 'not_found' };

    const parsed = parseStructuredMealPlanValue(current.calendar_payload, current.period);
    if (!parsed.success || !parsed.plan.schedule) return { status: 'invalid_plan' };
    if (
      !parsed.plan.schedule.portionConfirmation ||
      parsed.plan.schedule.portionConfirmation.peopleCount !== current.people_count
    ) {
      return { status: 'schedule_not_confirmed' };
    }
    const day = parsed.plan.days.find((candidate) => candidate.dayIndex === input.dayIndex);
    const meal = day?.meals.find((candidate) => candidate.mealType === input.mealType);
    if (!meal) return { status: 'slot_not_found' };

    const recipeResult = await client.query<{ id: string }>(
      `select id from public.user_recipes
       where id = $1 and tenant_id = $2 and user_id = $3 and archived_at is null`,
      [input.recipeId, input.tenantId, input.userId]
    );
    if (!recipeResult.rows[0]) return { status: 'recipe_not_found' };
    const versionResult = await client.query<{ id: string }>(
      `select id from public.user_recipe_versions
       where id = $1 and recipe_id = $2 and tenant_id = $3 and user_id = $4`,
      [input.versionId, input.recipeId, input.tenantId, input.userId]
    );
    if (!versionResult.rows[0]) return { status: 'version_not_found' };

    const currentRef = meal.recipeRef;
    if (currentRef?.recipeId === input.recipeId && currentRef.versionId === input.versionId) {
      return {
        status: 'already_applied',
        mealPlan: current,
        recipeId: input.recipeId,
        versionId: input.versionId,
      };
    }
    if (currentRef) return { status: 'conflict' };
    const expected = parseStructuredMealPlanValue(input.expectedCalendarPayload, current.period);
    if (!equalPostgresTimestamps(input.expectedUpdatedAt, input.expectedUpdatedAt) ||
        !expected.success || !isDeepStrictEqual(parsed.plan, expected.plan))
      return { status: 'conflict' };

    const snapshotResult = await client.query<{ matches: boolean }>(
      `select updated_at = $4::timestamptz and calendar_payload = $5::jsonb as matches
       from public.user_meal_plans
       where id = $1 and tenant_id = $2 and user_id = $3`,
      [
        input.mealPlanId,
        input.tenantId,
        input.userId,
        input.expectedUpdatedAt,
        JSON.stringify(current.calendar_payload),
      ]
    );
    if (!snapshotResult.rows[0]?.matches) return { status: 'conflict' };

    const nextPayload = attachRecipeReference(
      current.calendar_payload,
      input.dayIndex,
      input.mealType,
      input.recipeId,
      input.versionId
    );
    if (!nextPayload) return { status: 'invalid_plan' };
    const updatedResult = await client.query<UserMealPlanRow>(
      `update public.user_meal_plans
       set calendar_payload = $1::jsonb, updated_at = now()
       where id = $2 and tenant_id = $3 and user_id = $4
         and updated_at = $5::timestamptz and calendar_payload = $6::jsonb
       returning *`,
      [
        JSON.stringify(nextPayload),
        input.mealPlanId,
        input.tenantId,
        input.userId,
        input.expectedUpdatedAt,
        JSON.stringify(current.calendar_payload),
      ]
    );
    const updated = updatedResult.rows[0];
    if (!updated) return { status: 'conflict' };
    return {
      status: 'applied',
      mealPlan: updated,
      recipeId: input.recipeId,
      versionId: input.versionId,
    };
  });
}

export interface CreateMealPlanInput {
  tenantId: string;
  userId: string;
  peopleCount: number;
  period: MealPlanPeriod;
  mode: MealPlanMode;
  baseCuisine: string;
  fusionCuisines: string[];
  fusionIntensity: FusionIntensity;
  restrictions: string[];
  expectedHardRestrictions: readonly string[];
  inventorySnapshot: { inventoryLines: string[] };
  structuredPlan: StructuredMealPlan;
}

async function readLockedHardRestrictions(
  client: Parameters<typeof findCulinaryProfileByUserIdInTransaction>[0],
  userId: string,
  tenantId: string,
  requested: readonly string[]
): Promise<string[] | null> {
  const profile = await findCulinaryProfileByUserIdInTransaction(client, userId, tenantId);
  const terms = await findCulinaryProfileTermsByUserIdInTransaction(client, userId, tenantId);
  if (
    (profile &&
      (profile.user_id !== userId ||
        profile.tenant_id !== tenantId ||
        !Array.isArray(profile.allergies))) ||
    (!profile && terms.length > 0) ||
    terms.some(
      (term) =>
        term.user_id !== userId ||
        !['identity', 'prefer', 'avoid', 'goal'].includes(term.preference_type) ||
        typeof term.term_label !== 'string' ||
        !term.term_label.trim()
    )
  )
    return null;

  const restrictions = [
    ...requested,
    ...(profile?.allergies ?? []),
    ...terms.filter((term) => term.preference_type === 'avoid').map((term) => term.term_label),
  ];
  return readHardRestrictionList(restrictions);
}

export async function createMealPlan(input: CreateMealPlanInput): Promise<UserMealPlanRow | null> {
  const result = await scopedTransaction(
    { tenantId: input.tenantId, userId: input.userId },
    async (client) => {
      await lockInventorySourceTenant(client, input.tenantId);
      await lockCulinaryProfileUpdateInTransaction(client, input.userId, input.tenantId);
      const restrictions = await readLockedHardRestrictions(client, input.userId, input.tenantId, input.restrictions);
      // A new restriction was not seen by the provider, even if the local
      // guard cannot recognize its ingredients. Require a fresh proposal.
      if (!restrictions || restrictions.some((restriction) => !input.expectedHardRestrictions.includes(restriction)) ||
          hasRestrictedMealPlanContent(input.structuredPlan, restrictions)) return null;
      return client.query<UserMealPlanRow>(
        `insert into public.user_meal_plans
     (tenant_id, user_id, people_count, period, mode, base_cuisine, fusion_cuisines,
      fusion_intensity, restrictions, inventory_snapshot, calendar_payload, ai_content)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     returning *`,
        [
          input.tenantId,
          input.userId,
          input.peopleCount,
          input.period,
          input.mode,
          input.baseCuisine,
          input.fusionCuisines,
          input.fusionIntensity,
          input.restrictions,
          JSON.stringify({ ...input.inventorySnapshot, evaluatedHardRestrictions: [...new Set(input.expectedHardRestrictions)] }),
          JSON.stringify(input.structuredPlan),
          renderStructuredMealPlan(input.structuredPlan),
        ]
      );
    }
  );

  if (result === null) return null;
  const mealPlan = mapSingleRow(result);
  if (!mealPlan) {
    throw new MealPlanRepositoryError('Failed to create meal plan');
  }
  return mealPlan;
}

export async function findMealPlanByIdForUserAndTenant(
  id: string,
  userId: string,
  tenantId: string,
  scope?: AuthenticatedDbScope
): Promise<UserMealPlanRow | null> {
  if (scope && (scope.tenantId !== tenantId || scope.userId !== userId))
    throw new Error('Meal plan scope mismatch');
  const sql = `select * from public.user_meal_plans
     where id = $1 and tenant_id = $2 and user_id = $3
     limit 1`;
  const params = [id, tenantId, userId];
  const result = await scopedTransaction(scope ?? { tenantId, userId }, (client) =>
    client.query<UserMealPlanRow>(sql, params)
  );
  return mapSingleRow(result);
}

export interface UpdateMealPlanScheduleInput {
  mealPlanId: string;
  userId: string;
  tenantId: string;
  schedule: StructuredMealPlanSchedule;
  expectedUpdatedAt: string;
  expectedCalendarPayload: unknown;
  expectedPeopleCount: number;
  expectedPeriod: MealPlanPeriod;
}

export interface ReplaceMealPlanAdaptiveInput {
  mealPlanId: string;
  userId: string;
  tenantId: string;
  expectedUpdatedAt: string;
  expectedCalendarPayload: unknown;
  structuredPlan: StructuredMealPlan;
}

/** Replaces only an unchanged, tenant-scoped plan after explicit user confirmation. */
export async function replaceMealPlanForAdaptiveProposal(
  input: ReplaceMealPlanAdaptiveInput
): Promise<UserMealPlanRow | null> {
  const result = await scopedTransaction(
    { tenantId: input.tenantId, userId: input.userId },
    async (client) => {
      await lockInventorySourceTenant(client, input.tenantId);
      if (!equalPostgresTimestamps(input.expectedUpdatedAt, input.expectedUpdatedAt))
        return { rows: [] };
      // The profile lock covers both existing and absent profiles, including all
      // participating profile writers. Re-read under READ COMMITTED after waiting.
      await lockCulinaryProfileUpdateInTransaction(client, input.userId, input.tenantId);
      const current = (
        await client.query<UserMealPlanRow>(
          `select * from public.user_meal_plans
           where id = $1 and tenant_id = $2 and user_id = $3
             and updated_at = $4::timestamptz and calendar_payload = $5::jsonb
           for update`,
          [
            input.mealPlanId,
            input.tenantId,
            input.userId,
            input.expectedUpdatedAt,
            JSON.stringify(input.expectedCalendarPayload),
          ]
        )
      ).rows[0];
      if (
        !current ||
        current.id !== input.mealPlanId ||
        current.tenant_id !== input.tenantId ||
        current.user_id !== input.userId ||
        !Array.isArray(current.restrictions)
      )
        return { rows: [] };
      const restrictions = await readLockedHardRestrictions(client, input.userId, input.tenantId, current.restrictions);
      if (!restrictions || mealPlanRestrictionsChanged(current, restrictions) || hasRestrictedMealPlanContent(input.structuredPlan, restrictions)) return { rows: [] };
      return client.query<UserMealPlanRow>(
        `update public.user_meal_plans
        set calendar_payload = $1::jsonb,
            ai_content = $2,
            updated_at = now()
      where id = $3 and tenant_id = $4 and user_id = $5
        and updated_at = $6::timestamptz
        and calendar_payload = $7::jsonb
      returning *`,
        [
          JSON.stringify(input.structuredPlan),
          renderStructuredMealPlan(input.structuredPlan),
          input.mealPlanId,
          input.tenantId,
          input.userId,
          input.expectedUpdatedAt,
          JSON.stringify(input.expectedCalendarPayload),
        ]
      );
    },
    { isolationLevel: 'read committed' }
  );
  return result.rows[0] ?? null;
}

export async function updateMealPlanScheduleForUserAndTenant(
  input: UpdateMealPlanScheduleInput
): Promise<UserMealPlanRow | null> {
  return scopedTransaction(
    { tenantId: input.tenantId, userId: input.userId },
    async (client) => {
      await lockInventorySourceTenant(client, input.tenantId);
      const schedule = parseStructuredMealPlanSchedule(input.schedule);
      if (
        !schedule ||
        schedule.portionConfirmation?.peopleCount !== input.expectedPeopleCount ||
        !equalPostgresTimestamps(input.expectedUpdatedAt, input.expectedUpdatedAt)
      )
        return null;
      const today = getLocalDateInTimeZone(new Date(), schedule.timeZone);
      if (!today || schedule.startDate < today) return null;
      const parsed = parseStructuredMealPlanValue(
        input.expectedCalendarPayload,
        input.expectedPeriod
      );
      if (!parsed.success) return null;
      const updated = await client.query<UserMealPlanRow>(
        `update public.user_meal_plans
        set calendar_payload = jsonb_set(calendar_payload, '{schedule}', $1::jsonb, true),
            updated_at = now()
      where id = $2 and tenant_id = $3 and user_id = $4
        and updated_at = $5::timestamptz and calendar_payload = $6::jsonb
        and people_count = $7 and period = $8
      returning *`,
        [
          JSON.stringify(schedule),
          input.mealPlanId,
          input.tenantId,
          input.userId,
          input.expectedUpdatedAt,
          JSON.stringify(input.expectedCalendarPayload),
          input.expectedPeopleCount,
          input.expectedPeriod,
        ]
      );
      return updated.rows[0] ?? null;
    },
    { isolationLevel: 'read committed' }
  );
}

export async function findLatestMealPlanByUserAndTenant(
  userId: string,
  tenantId: string
): Promise<UserMealPlanRow | null> {
  const result = await scopedTransaction({ tenantId, userId }, (client) =>
    client.query<UserMealPlanRow>(
      `select * from public.user_meal_plans
     where tenant_id = $1 and user_id = $2
     order by created_at desc, id desc
     limit 1`,
      [tenantId, userId]
    )
  );
  return mapSingleRow(result);
}

/** Read or update quantity review under the same profile and plan locks. */
export async function withQuantityReviewSource<T>(
  scope: { tenantId: string; userId: string },
  mealPlanId: string,
  action: (client: DbTransactionClient, plan: UserMealPlanRow, restrictions: string[]) => Promise<T>
): Promise<T | null> {
  return scopedTransaction(scope, async client => {
    await lockInventorySourceTenant(client, scope.tenantId);
    await lockCulinaryProfileUpdateInTransaction(client, scope.userId, scope.tenantId);
    const row = (await client.query<UserMealPlanRow>(
      `select * from public.user_meal_plans where id = $1 and tenant_id = $2 and user_id = $3 for update`,
      [mealPlanId, scope.tenantId, scope.userId]
    )).rows[0];
    if (!row || row.user_id !== scope.userId || row.tenant_id !== scope.tenantId || !Array.isArray(row.restrictions)) return null;
    const restrictions = await readLockedHardRestrictions(client, scope.userId, scope.tenantId, row.restrictions);
    if (!restrictions) throw new Error('Invalid restrictions');
    return action(client, row, restrictions);
  }, { isolationLevel: 'read committed' });
}
