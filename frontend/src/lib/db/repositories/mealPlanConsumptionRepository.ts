import { lockInventorySourceTenant } from '@/lib/db/inventory-source-lock';
import {
  parseExactQuantity,
  compareQuantity,
  subtractQuantity,
  quantityNumber,
  zeroQuantity,
} from '@/lib/inventory/exact-quantity';
import { planRationalStockDeduction } from '@/lib/inventory/stock-precision';
import { inventoryExpirationStatus } from '@/lib/meal-planner/expiration-date';
import { scopedTransaction } from '@/lib/db';
import type { RecipeInventoryItemRow, UserMealPlanRow } from '@/lib/db/types';
import type { DbTransactionClient } from '@/lib/db/transaction-client';
import { normalizeInventoryName } from '@/lib/inventory/normalize-inventory';
import {
  convertExactQuantity,
  normalizeExplicitUnit,
  parseExactStoredQuantity,
  type NormalizedUnit,
} from '@/lib/inventory/quantity-normalization';
import {
  mealConsumptionKey,
  parseMealConsumptionPayload,
  type MealConsumptionRecord,
} from '@/lib/meal-planner/consumption';
import {
  parseStructuredMealPlanValue,
  type StructuredMealType,
} from '@/lib/meal-planner/structured-plan';
import { claimPlannedMealInTransaction } from '@/lib/db/repositories/realConsumptionRepository';

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
    public readonly code: 'not_found' | 'invalid_plan' | 'invalid_meal' | 'already_claimed' | 'linked_recipe',
    message: string
  ) {
    super(message);
    this.name = 'MealPlanConsumptionError';
  }
}

function normalizedInventoryName(item: RecipeInventoryItemRow): string {
  return normalizeInventoryName(item.ingredient_name);
}

async function lockPlan(
  client: DbTransactionClient,
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

async function lockInventory(
  client: DbTransactionClient,
  tenantId: string,
  userId: string
): Promise<RecipeInventoryItemRow[]> {
  const result = await client.query<RecipeInventoryItemRow>(
    `select * from public.recipe_inventory_items
      where tenant_id=$1 and user_id=$2
      order by expiration_date asc nulls last, created_at asc, id asc
      for update`,
    [tenantId, userId]
  );
  return result.rows;
}

async function decrementInventoryRow(
  client: DbTransactionClient,
  row: RecipeInventoryItemRow,
  quantity: number,
  remaining: number,
  unit: NormalizedUnit,
  input: ConsumePlannedMealInput,
  mealTitle: string,
  normalizedName: string
) {
  // Both values have already been checked against NUMERIC(12,4); never round.
  const storedQuantity = row.unit?.trim() ? String(remaining) : `${remaining} ${unit}`;
  const updated = await client.query<{ id: string }>(
    `update public.recipe_inventory_items
        set quantity=$1, updated_at=now()
      where id=$2 and tenant_id=$3 and user_id=$4 returning id`,
    [storedQuantity, row.id, input.tenantId, input.userId]
  );
  if (updated.rows[0]?.id !== row.id) throw new Error('Locked inventory update failed');
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
  client: DbTransactionClient,
  inventory: RecipeInventoryItemRow[],
  ingredient: { name: string; quantity: number | null; unit: string | null },
  input: ConsumePlannedMealInput,
  mealTitle: string,
  record: MealConsumptionRecord,
  now: Date,
  timeZone: string
) {
  const normalizedName = normalizeInventoryName(ingredient.name);
  const requiredUnit = normalizeExplicitUnit(ingredient.unit);
  const required = ingredient.quantity === null ? null : parseExactQuantity(ingredient.quantity);
  if (!required || requiredUnit === 'unknown') {
    record.skipped.push({
      ingredientName: ingredient.name,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
      reason: 'unknown_quantity_or_unit',
    });
    return;
  }
  if (required.numerator <= BigInt(0)) return;

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

  let remainingRequired = required;
  let hadComparableInventory = false;
  let precisionBlocked = false;
  let expired = false;
  let invalidExpiry = false;
  let eligible = false;
  for (const row of candidates) {
    if (compareQuantity(remainingRequired, zeroQuantity) <= 0) break;
    const expiry = inventoryExpirationStatus(row.expiration_date, now, timeZone);
    if (expiry !== 'eligible') {
      expired ||= expiry === 'expired';
      invalidExpiry ||= expiry === 'invalid';
      continue;
    }
    eligible = true;
    const parsed = parseExactStoredQuantity(row);
    if (!parsed || parsed.quantity.numerator <= BigInt(0)) continue;
    const availableInRequired = convertExactQuantity(parsed.quantity, parsed.unit, requiredUnit);
    if (!availableInRequired) continue;
    hadComparableInventory = true;
    const takeRequired =
      compareQuantity(remainingRequired, availableInRequired) <= 0
        ? remainingRequired
        : availableInRequired;
    const takeInventory = convertExactQuantity(takeRequired, requiredUnit, parsed.unit);
    if (!takeInventory) continue;
    const deduction = planRationalStockDeduction(parsed.quantity, takeInventory);
    if (!deduction.ok) {
      precisionBlocked ||= deduction.reason === 'precision';
      continue;
    }
    await decrementInventoryRow(
      client,
      row,
      deduction.quantity,
      deduction.remaining,
      parsed.unit,
      input,
      mealTitle,
      normalizedName
    );
    record.decrements.push({
      inventoryItemId: row.id,
      ingredientName: ingredient.name,
      quantity: deduction.quantity,
      unit: parsed.unit,
    });
    remainingRequired = subtractQuantity(remainingRequired, takeRequired);
  }
  if (compareQuantity(remainingRequired, zeroQuantity) > 0) {
    record.skipped.push({
      ingredientName: ingredient.name,
      quantity: quantityNumber(remainingRequired),
      unit: ingredient.unit,
      reason: precisionBlocked
        ? 'unrepresentable_inventory_quantity'
        : !eligible && expired
          ? 'expired_inventory'
          : !eligible && invalidExpiry
            ? 'invalid_expiration_date'
            : hadComparableInventory
              ? 'insufficient_tracked_quantity'
              : 'incompatible_or_unstructured_inventory',
    });
  }
}

export async function consumePlannedMealInTransaction(
  client: DbTransactionClient,
  input: ConsumePlannedMealInput
): Promise<ConsumePlannedMealResult> {
  await lockInventorySourceTenant(client, input.tenantId);
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
  if (meal.recipeRef) throw new MealPlanConsumptionError('linked_recipe', 'Use the linked recipe cooking session to record actual consumption');
  // Never discard malformed legacy evidence while claiming a new slot.
  const raw = persistedPlan.consumption_payload;
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.keys(raw).length !== Object.keys(payload).length
  )
    throw new MealPlanConsumptionError('invalid_plan', 'Invalid persisted consumption evidence');

  const claim = await claimPlannedMealInTransaction(client, {
    tenantId: input.tenantId,
    userId: input.userId,
    mealPlanId: input.mealPlanId,
    dayIndex: input.dayIndex,
    mealType: input.mealType,
  });
  if (claim.status === 'already_claimed') {
    throw new MealPlanConsumptionError(
      'already_claimed',
      claim.mode === 'real_reconciliation'
        ? 'Meal slot already reconciled.'
        : 'Meal slot already consumed.'
    );
  }

  const now = new Date();
  const record: MealConsumptionRecord = {
    consumedAt: now.toISOString(),
    dayIndex: input.dayIndex,
    mealType: input.mealType,
    mealTitle: meal.title,
    decrements: [],
    skipped: [],
  };
  const inventory = await lockInventory(client, input.tenantId, input.userId);
  for (const ingredient of meal.ingredients) {
    await consumeIngredient(
      client,
      inventory,
      ingredient,
      input,
      meal.title,
      record,
      now,
      parsedPlan.plan.schedule?.timeZone ?? 'UTC'
    );
  }

  const nextPayload = { ...raw, [key]: record };
  const updated = await client.query<{ id: string }>(
    `update public.user_meal_plans
          set consumption_payload=$1::jsonb, updated_at=now()
        where id=$2 and tenant_id=$3 and user_id=$4 returning id`,
    [JSON.stringify(nextPayload), input.mealPlanId, input.tenantId, input.userId]
  );
  if (updated.rows[0]?.id !== input.mealPlanId) throw new Error('Locked meal plan update failed');
  return { alreadyConsumed: false, record };
}

export async function consumePlannedMeal(
  input: ConsumePlannedMealInput
): Promise<ConsumePlannedMealResult> {
  return scopedTransaction(
    { tenantId: input.tenantId, userId: input.userId },
    (client) => consumePlannedMealInTransaction(client, input),
    { isolationLevel: 'read committed' }
  );
}

export async function getMealPlanConsumptions(
  mealPlanId: string,
  userId: string,
  tenantId: string
) {
  const result = await scopedTransaction({ tenantId, userId }, (client) =>
    client.query<Pick<UserMealPlanRow, 'consumption_payload'>>(
      `select consumption_payload from public.user_meal_plans
      where id=$1 and tenant_id=$2 and user_id=$3
      limit 1`,
      [mealPlanId, tenantId, userId]
    )
  );
  const row = result.rows[0];
  return row ? parseMealConsumptionPayload(row.consumption_payload) : null;
}
