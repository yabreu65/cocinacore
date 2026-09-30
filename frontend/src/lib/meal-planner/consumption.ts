import type { StructuredMealType } from './structured-plan';

export type MealConsumptionDecrement = {
  inventoryItemId: string;
  ingredientName: string;
  quantity: number;
  unit: string;
};

export type MealConsumptionSkipReason =
  | 'unknown_quantity_or_unit'
  | 'not_in_inventory'
  | 'incompatible_or_unstructured_inventory'
  | 'insufficient_tracked_quantity';

export type MealConsumptionSkip = {
  ingredientName: string;
  quantity: number | null;
  unit: string | null;
  reason: MealConsumptionSkipReason;
};

export type MealConsumptionRecord = {
  consumedAt: string;
  dayIndex: number;
  mealType: StructuredMealType;
  mealTitle: string;
  decrements: MealConsumptionDecrement[];
  skipped: MealConsumptionSkip[];
};

export type MealConsumptionPayload = Record<string, MealConsumptionRecord>;

export function mealConsumptionKey(dayIndex: number, mealType: StructuredMealType): string {
  return `${dayIndex}:${mealType}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isMealType(value: unknown): value is StructuredMealType {
  return value === 'breakfast' || value === 'lunch' || value === 'dinner';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseDecrement(value: unknown): MealConsumptionDecrement | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.inventoryItemId !== 'string' ||
    !value.inventoryItemId ||
    typeof value.ingredientName !== 'string' ||
    !value.ingredientName ||
    !isFiniteNumber(value.quantity) ||
    value.quantity <= 0 ||
    typeof value.unit !== 'string' ||
    !value.unit
  )
    return null;
  return {
    inventoryItemId: value.inventoryItemId,
    ingredientName: value.ingredientName,
    quantity: value.quantity,
    unit: value.unit,
  };
}

function isSkipReason(value: unknown): value is MealConsumptionSkipReason {
  return (
    value === 'unknown_quantity_or_unit' ||
    value === 'not_in_inventory' ||
    value === 'incompatible_or_unstructured_inventory' ||
    value === 'insufficient_tracked_quantity'
  );
}

function parseSkip(value: unknown): MealConsumptionSkip | null {
  if (!isRecord(value)) return null;
  const { ingredientName, quantity, unit, reason } = value;
  if (typeof ingredientName !== 'string' || !ingredientName) return null;
  if (quantity !== null && (!isFiniteNumber(quantity) || quantity < 0)) return null;
  if (unit !== null && typeof unit !== 'string') return null;
  if (!isSkipReason(reason)) return null;
  return { ingredientName, quantity, unit, reason };
}

export function parseMealConsumptionPayload(value: unknown): MealConsumptionPayload {
  if (!isRecord(value)) return {};
  const output: MealConsumptionPayload = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue;
    const { consumedAt, dayIndex, mealType, mealTitle } = entry;
    if (
      typeof consumedAt !== 'string' ||
      Number.isNaN(Date.parse(consumedAt)) ||
      !isFiniteNumber(dayIndex) ||
      !Number.isInteger(dayIndex) ||
      dayIndex < 1 ||
      dayIndex > 30 ||
      !isMealType(mealType) ||
      typeof mealTitle !== 'string' ||
      !mealTitle ||
      !Array.isArray(entry.decrements) ||
      !Array.isArray(entry.skipped) ||
      key !== mealConsumptionKey(dayIndex, mealType)
    )
      continue;
    const decrements: MealConsumptionDecrement[] = [];
    let invalidNestedEntry = false;
    for (const raw of entry.decrements) {
      const parsed = parseDecrement(raw);
      if (!parsed) {
        invalidNestedEntry = true;
        break;
      }
      decrements.push(parsed);
    }
    if (invalidNestedEntry) continue;

    const skipped: MealConsumptionSkip[] = [];
    for (const raw of entry.skipped) {
      const parsed = parseSkip(raw);
      if (!parsed) {
        invalidNestedEntry = true;
        break;
      }
      skipped.push(parsed);
    }
    if (invalidNestedEntry) continue;
    output[key] = { consumedAt, dayIndex, mealType, mealTitle, decrements, skipped };
  }
  return output;
}

export function formatStoredInventoryQuantity(
  value: number,
  unitColumn: string | null,
  parsedUnit: string
): string {
  const rounded = Number(Math.max(0, value).toFixed(4)).toString();
  if (unitColumn?.trim()) return rounded;
  return parsedUnit === 'unidad' ? rounded : `${rounded} ${parsedUnit}`;
}
