import { mapSingleRow, query } from '@/lib/db';
import type {
  FusionIntensity,
  MealPlanMode,
  MealPlanPeriod,
  UserMealPlanRow,
} from '@/lib/db/types';
import {
  renderStructuredMealPlan,
  type StructuredMealPlan,
  type StructuredMealPlanSchedule,
} from '@/lib/meal-planner/structured-plan';

export class MealPlanRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MealPlanRepositoryError';
  }
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
  const result = await query<UserMealPlanRow>(
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
  tenantId: string
): Promise<UserMealPlanRow | null> {
  const result = await query<UserMealPlanRow>(
    `select * from public.user_meal_plans
     where id = $1 and tenant_id = $2 and user_id = $3
     limit 1`,
    [id, tenantId, userId]
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
  const result = await query<UserMealPlanRow>(
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
  return mapSingleRow(result);
}

export async function updateMealPlanScheduleForUserAndTenant(
  input: UpdateMealPlanScheduleInput
): Promise<UserMealPlanRow | null> {
  const result = await query<UserMealPlanRow>(
    `update public.user_meal_plans
        set calendar_payload = jsonb_set(calendar_payload, '{schedule}', $1::jsonb, true),
            updated_at = now()
      where id = $2 and tenant_id = $3 and user_id = $4
      returning *`,
    [JSON.stringify(input.schedule), input.mealPlanId, input.tenantId, input.userId]
  );
  return mapSingleRow(result);
}

export async function findLatestMealPlanByUserAndTenant(
  userId: string,
  tenantId: string
): Promise<UserMealPlanRow | null> {
  const result = await query<UserMealPlanRow>(
    `select * from public.user_meal_plans
     where tenant_id = $1 and user_id = $2
     order by created_at desc, id desc
     limit 1`,
    [tenantId, userId]
  );
  return mapSingleRow(result);
}
