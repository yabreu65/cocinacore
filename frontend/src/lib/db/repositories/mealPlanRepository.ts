import { mapSingleRow, scopedTransaction, type AuthenticatedDbScope } from '@/lib/db';
import type {
  FusionIntensity,
  MealPlanMode,
  MealPlanPeriod,
  UserMealPlanRow,
} from '@/lib/db/types';
import {
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

    const snapshotResult = await client.query<{ matches: boolean }>(
      `select updated_at = $4::timestamptz and calendar_payload = $5::jsonb as matches
       from public.user_meal_plans
       where id = $1 and tenant_id = $2 and user_id = $3`,
      [
        input.mealPlanId,
        input.tenantId,
        input.userId,
        input.expectedUpdatedAt,
        JSON.stringify(input.expectedCalendarPayload),
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
        JSON.stringify(input.expectedCalendarPayload),
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
  inventorySnapshot: { inventoryLines: string[] };
  structuredPlan: StructuredMealPlan;
}

export async function createMealPlan(input: CreateMealPlanInput): Promise<UserMealPlanRow> {
  const result = await scopedTransaction(
    { tenantId: input.tenantId, userId: input.userId },
    (client) =>
      client.query<UserMealPlanRow>(
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
          JSON.stringify(input.inventorySnapshot),
          JSON.stringify(input.structuredPlan),
          renderStructuredMealPlan(input.structuredPlan),
        ]
      )
  );

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
    (client) =>
      client.query<UserMealPlanRow>(
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
      )
  );
  return mapSingleRow(result);
}

export async function updateMealPlanScheduleForUserAndTenant(
  input: UpdateMealPlanScheduleInput
): Promise<UserMealPlanRow | null> {
  const result = await scopedTransaction(
    { tenantId: input.tenantId, userId: input.userId },
    (client) =>
      client.query<UserMealPlanRow>(
        `update public.user_meal_plans
        set calendar_payload = jsonb_set(calendar_payload, '{schedule}', $1::jsonb, true),
            updated_at = now()
      where id = $2 and tenant_id = $3 and user_id = $4
      returning *`,
        [JSON.stringify(input.schedule), input.mealPlanId, input.tenantId, input.userId]
      )
  );
  return mapSingleRow(result);
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
