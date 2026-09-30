import type { PoolClient } from 'pg';
import { query, transaction } from '@/lib/db';
import type { RecipeInventoryItemRow, UserMealPlanRow } from '@/lib/db/types';
import { normalizeInventoryName } from '@/lib/inventory/normalize-inventory';
import {
  canCompareUnits,
  convertQuantity,
  normalizeUnit,
  parseQuantity,
  type NormalizedUnit,
} from '@/lib/inventory/quantity-normalization';
import {
  formatStoredInventoryQuantity,
  mealConsumptionKey,
  parseMealConsumptionPayload,
  type MealConsumptionRecord,
} from '@/lib/meal-planner/consumption';
import {
  parseStructuredMealPlanValue,
  type StructuredMealType,
} from '@/lib/meal-planner/structured-plan';

export type ConsumePlannedMealInput = {
  mealPlanId: string;
  tenantId: string;
  userId: string;
  dayIndex: number;
  mealType: StructuredMealType;
};

export type ConsumePlannedMealResult = {
  alreadyConsumed: boolean;
  record: MealConsumptionRecord;
};

export class MealPlanConsumptionError extends Error {
  constructor(
    public readonly code: 'not_found' | 'invalid_plan' | 'invalid_meal',
    message: string
  ) {
    super(message);
    this.name = 'MealPlanConsumptionError';
  }
}

function parseInventoryQuantity(item: RecipeInventoryItemRow) {
  return parseQuantity(
    [item.quantity ?? '', item.unit ?? ''].filter(Boolean).join(' ').trim()
  );
}

function amountInUnit(
  value: number,
  fromUnit: NormalizedUnit,
  toUnit: NormalizedUnit
): number | null {
  if (fromUnit === toUnit) return value;
  return convertQuantity(value, fromUnit, toUnit);
}

function normalizedInventoryName(item: RecipeInventoryItemRow): string {
  return item.normalized_name?.trim() || normalizeInventoryName(item.ingredient_name);
}

async function lockPlan(
  client: PoolClient,
  input: ConsumePlannedMealInput
): Promise<UserMealPlanRow> {
  const result = await client.query<UserMealPlanRow>(
    `select * from public.user_meal_plans
      where id=$1 and tenant_id=$2 and user_id=$3
      for update`,
    [input.mealPlanId, input.tenantId, input.userId]
  );
  const plan = result.rows[0];
  if (!plan) throw new MealPlanConsumptionError('not_found', 'Meal plan not found');
  return plan;
}

async function lockInventory(client: PoolClient, tenantId: string): Promise<RecipeInventoryItemRow[]> {
  const result = await client.query<RecipeInventoryItemRow>(
    `select * from public.recipe_inventory_items
      where tenant_id=$1
      order by expiration_date asc nulls last, created_at asc, id asc
      for update`,
    [tenantId]
  );
  return result.rows;
}

async function decrementInventoryRow(
  client: PoolClient,
  row: RecipeInventoryItemRow,
  quantity: number,
  unit: NormalizedUnit,
  input: ConsumePlannedMealInput,
  mealTitle: string,
  normalizedName: string
) {
  const parsed = parseInventoryQuantity(row);
  const nextValue = Math.max(0, (parsed.value ?? 0) - quantity);
  const storedQuantity = formatStoredInventoryQuantity(nextValue, row.unit, unit);
  await client.query(
    `update public.recipe_inventory_items
        set quantity=$1, updated_at=now()
      where id=$2 and tenant_id=$3`,
    [storedQuantity, row.id, input.tenantId]
  );
  row.quantity = storedQuantity;

  await client.query(
    `insert into public.inventory_movements
      (tenant_id, user_id, inventory_item_id, movement_type, quantity, unit,
       normalized_name, source, source_recipe, source_meal_plan_id, notes)
     values ($1,$2,$3,'recipe_consumption',$4,$5,$6,$7,$8,$9,$10)`,
    [
      input.tenantId,
      input.userId,
      row.id,
      quantity,
      unit,
      normalizedName,
      `meal-plan-consumption:${input.mealPlanId}:${input.dayIndex}:${input.mealType}`,
      mealTitle,
      input.mealPlanId,
      'Confirmed by user via Ya cociné',
    ]
  );
}

async function consumeIngredient(
  client: PoolClient,
  inventory: RecipeInventoryItemRow[],
  ingredient: { name: string; quantity: number | null; unit: string | null },
  input: ConsumePlannedMealInput,
  mealTitle: string,
  record: MealConsumptionRecord
) {
  const normalizedName = normalizeInventoryName(ingredient.name);
  const requiredUnit = normalizeUnit(ingredient.unit);
  if (ingredient.quantity === null || requiredUnit === 'unknown') {
    record.skipped.push({
      ingredientName: ingredient.name,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
      reason: 'unknown_quantity_or_unit',
    });
    return;
  }
  if (ingredient.quantity <= 0) return;

  const candidates = inventory.filter((item) => normalizedInventoryName(item) === normalizedName);
  if (candidates.length === 0) {
    record.skipped.push({
      ingredientName: ingredient.name,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
      reason: 'not_in_inventory',
    });
    return;
  }

  let remainingRequired = ingredient.quantity;
  let hadComparableInventory = false;
  for (const row of candidates) {
    if (remainingRequired <= 0.000001) break;
    const parsed = parseInventoryQuantity(row);
    if (
      !parsed.structured ||
      parsed.value === null ||
      parsed.value <= 0 ||
      parsed.unit === 'unknown' ||
      !canCompareUnits(parsed.unit, requiredUnit)
    ) continue;

    const availableInRequired = amountInUnit(parsed.value, parsed.unit, requiredUnit);
    if (availableInRequired === null || availableInRequired <= 0) continue;
    hadComparableInventory = true;

    const takeRequired = Math.min(remainingRequired, availableInRequired);
    const takeInventory = amountInUnit(takeRequired, requiredUnit, parsed.unit);
    if (takeInventory === null || takeInventory <= 0) continue;

    await decrementInventoryRow(
      client,
      row,
      takeInventory,
      parsed.unit,
      input,
      mealTitle,
      normalizedName
    );
    record.decrements.push({
      inventoryItemId: row.id,
      ingredientName: ingredient.name,
      quantity: Number(takeInventory.toFixed(4)),
      unit: parsed.unit,
    });
    remainingRequired = Math.max(0, remainingRequired - takeRequired);
  }

  if (remainingRequired > 0.000001) {
    record.skipped.push({
      ingredientName: ingredient.name,
      quantity: Number(remainingRequired.toFixed(4)),
      unit: ingredient.unit,
      reason: hadComparableInventory
        ? 'insufficient_tracked_quantity'
        : 'incompatible_or_unstructured_inventory',
    });
  }
}

export async function consumePlannedMealInTransaction(
  client: PoolClient,
  input: ConsumePlannedMealInput
): Promise<ConsumePlannedMealResult> {
    const persistedPlan = await lockPlan(client, input);
    if (!['week', 'fortnight', 'month'].includes(persistedPlan.period)) {
      throw new MealPlanConsumptionError('invalid_plan', 'Meal plan period is invalid');
    }
    const parsedPlan = parseStructuredMealPlanValue(
      persistedPlan.calendar_payload,
      persistedPlan.period
    );
    if (!parsedPlan.success) {
      throw new MealPlanConsumptionError('invalid_plan', 'Meal plan payload is invalid');
    }

    const day = parsedPlan.plan.days.find((entry) => entry.dayIndex === input.dayIndex);
    const meal = day?.meals.find((entry) => entry.mealType === input.mealType);
    if (!meal) throw new MealPlanConsumptionError('invalid_meal', 'Meal is not part of the plan');

    const payload = parseMealConsumptionPayload(persistedPlan.consumption_payload);
    const key = mealConsumptionKey(input.dayIndex, input.mealType);
    const existing = payload[key];
    if (existing) return { alreadyConsumed: true, record: existing };

    const record: MealConsumptionRecord = {
      consumedAt: new Date().toISOString(),
      dayIndex: input.dayIndex,
      mealType: input.mealType,
      mealTitle: meal.title,
      decrements: [],
      skipped: [],
    };
    const inventory = await lockInventory(client, input.tenantId);
    for (const ingredient of meal.ingredients) {
      await consumeIngredient(client, inventory, ingredient, input, meal.title, record);
    }

    payload[key] = record;
    await client.query(
      `update public.user_meal_plans
          set consumption_payload=$1::jsonb, updated_at=now()
        where id=$2 and tenant_id=$3 and user_id=$4`,
      [JSON.stringify(payload), input.mealPlanId, input.tenantId, input.userId]
    );
    return { alreadyConsumed: false, record };
}

export async function consumePlannedMeal(
  input: ConsumePlannedMealInput
): Promise<ConsumePlannedMealResult> {
  return transaction((client) => consumePlannedMealInTransaction(client, input));
}

export async function getMealPlanConsumptions(
  mealPlanId: string,
  userId: string,
  tenantId: string
) {
  const result = await query<Pick<UserMealPlanRow, 'consumption_payload'>>(
    `select consumption_payload from public.user_meal_plans
      where id=$1 and tenant_id=$2 and user_id=$3
      limit 1`,
    [mealPlanId, tenantId, userId]
  );
  const row = result.rows[0];
  return row ? parseMealConsumptionPayload(row.consumption_payload) : null;
}
