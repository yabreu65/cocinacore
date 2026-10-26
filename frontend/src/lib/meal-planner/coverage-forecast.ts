import {
  buildMealPlanInventoryProjection,
  type MealPlanProjectionItem,
} from '@/lib/inventory/meal-plan-projection';
import {
  type InventoryComparableItem,
  type RecipeRequirement,
} from '@/lib/inventory/recipe-requirements';
import {
  canCompareUnits,
  normalizeUnit,
  parseQuantity,
} from '@/lib/inventory/quantity-normalization';
import { normalizeInventoryName } from '@/lib/inventory/normalize-inventory';
import {
  mealConsumptionKey,
  parseMealConsumptionPayload,
  type MealConsumptionPayload,
} from './consumption';
import {
  getLocalDateInTimeZone,
  parseStructuredMealPlanSchedule,
  type StructuredMealPlan,
  type StructuredMealPlanSchedule,
} from './structured-plan';

export type MealPlanCoverageUnknownReason =
  | 'no_saved_plan'
  | 'schedule_not_confirmed'
  | 'invalid_schedule'
  | 'invalid_horizon'
  | 'invalid_consumption'
  | 'no_future_meals_in_horizon'
  | 'plan_does_not_cover_horizon';

export type MealPlanCoverageForecast = {
  status: 'ready' | 'unknown';
  reason?: MealPlanCoverageUnknownReason;
  horizonDays: number;
  timeZone: string | null;
  fromDate: string | null;
  throughDate: string | null;
  scheduledMealCount: number;
  consumedMealCount: number;
  items: MealPlanProjectionItem[];
  summary: {
    sufficient: number;
    partial: number;
    missing: number;
    unknown: number;
  };
};

export interface BuildMealPlanCoverageForecastInput {
  plan: StructuredMealPlan;
  inventoryItems: InventoryComparableItem[];
  consumptionPayload: unknown;
  horizonDays: number;
  now: Date;
}

function emptySummary() {
  return { sufficient: 0, partial: 0, missing: 0, unknown: 0 };
}

export function createUnknownMealPlanCoverageForecast(
  horizonDays: number,
  reason: MealPlanCoverageUnknownReason,
  timeZone: string | null = null,
  fromDate: string | null = null,
  throughDate: string | null = null
): MealPlanCoverageForecast {
  return {
    status: 'unknown',
    reason,
    horizonDays,
    timeZone,
    fromDate,
    throughDate,
    scheduledMealCount: 0,
    consumedMealCount: 0,
    items: [],
    summary: emptySummary(),
  };
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isCanonicalUtcTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function addCalendarDays(date: string, days: number): string | null {
  if (!isValidIsoDate(date) || !Number.isInteger(days)) return null;
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return Number.isNaN(result.getTime()) ? null : result.toISOString().slice(0, 10);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readConsumptionPayload(
  value: unknown,
  plan: StructuredMealPlan,
  schedule: StructuredMealPlanSchedule
): { valid: true; records: MealConsumptionPayload } | { valid: false } {
  if (!isRecord(value)) return { valid: false };
  const records = parseMealConsumptionPayload(value);
  const currentScheduleRecords: MealConsumptionPayload = {};
  const planMeals = new Set(
    plan.days.flatMap((day) =>
      day.meals.map((meal) => mealConsumptionKey(day.dayIndex, meal.mealType))
    )
  );
  for (const key of Object.keys(value)) {
    const parsedRecord = records[key];
    if (!parsedRecord || !isCanonicalUtcTimestamp(parsedRecord.consumedAt) || !planMeals.has(key)) {
      return { valid: false };
    }
    if (parsedRecord.dayIndex < 1 || parsedRecord.dayIndex > plan.dayCount) return { valid: false };

    const scheduledDate = addCalendarDays(schedule.startDate, parsedRecord.dayIndex - 1);
    const consumedDate = getLocalDateInTimeZone(
      new Date(parsedRecord.consumedAt),
      schedule.timeZone
    );
    if (!scheduledDate || !consumedDate) return { valid: false };
    if (consumedDate === scheduledDate) currentScheduleRecords[key] = parsedRecord;
  }
  return { valid: true, records: currentScheduleRecords };
}

function buildRequirements(
  plan: StructuredMealPlan,
  fromDate: string,
  throughDateExclusive: string,
  consumption: MealConsumptionPayload
): { requirements: RecipeRequirement[]; scheduledMealCount: number; consumedMealCount: number } {
  const requirements: RecipeRequirement[] = [];
  let scheduledMealCount = 0;
  let consumedMealCount = 0;

  for (const day of plan.days) {
    const scheduledDate = addCalendarDays(plan.schedule!.startDate, day.dayIndex - 1);
    if (!scheduledDate || scheduledDate < fromDate || scheduledDate >= throughDateExclusive)
      continue;

    for (const meal of day.meals) {
      scheduledMealCount += 1;
      if (consumption[mealConsumptionKey(day.dayIndex, meal.mealType)]) {
        consumedMealCount += 1;
        continue;
      }
      for (const ingredient of meal.ingredients) {
        if (ingredient.quantity === 0) continue;
        const requiredUnit = normalizeUnit(ingredient.unit);
        const quantity =
          typeof ingredient.quantity === 'number' &&
          Number.isFinite(ingredient.quantity) &&
          ingredient.quantity > 0
            ? ingredient.quantity
            : null;
        requirements.push({
          ingredientName: ingredient.name,
          normalizedName: normalizeInventoryName(ingredient.name),
          requiredQuantity: requiredUnit === 'unknown' ? null : quantity,
          requiredUnit,
          usedInRecipes: [`${meal.title} · ${scheduledDate}`],
        });
      }
    }
  }

  return { requirements, scheduledMealCount, consumedMealCount };
}

function markUnquantifiedInventoryUnknown(
  items: MealPlanProjectionItem[],
  inventoryItems: InventoryComparableItem[]
): MealPlanProjectionItem[] {
  return items.map((item) => {
    const matchingRows = inventoryItems.filter(
      (inventory) => normalizeInventoryName(inventory.ingredient_name) === item.normalizedName
    );
    if (matchingRows.length === 0) return asUnknown(item);

    const allRowsComparable = matchingRows.every((inventory) => {
      const parsed = parseQuantity(
        [inventory.quantity ?? '', inventory.unit ?? ''].filter(Boolean).join(' ').trim()
      );
      return (
        parsed.structured &&
        parsed.value !== null &&
        parsed.unit !== 'unknown' &&
        item.requiredUnit !== 'unknown' &&
        canCompareUnits(parsed.unit, item.requiredUnit)
      );
    });
    return allRowsComparable ? item : asUnknown(item);
  });
}

function asUnknown(item: MealPlanProjectionItem): MealPlanProjectionItem {
  return {
    ...item,
    availableQuantity: null,
    availableUnit: 'unknown',
    projectedUsedQuantity: null,
    projectedRemainingQuantity: null,
    missingQuantity: null,
    status: 'unknown',
  };
}

export function buildMealPlanCoverageForecast(
  input: BuildMealPlanCoverageForecastInput
): MealPlanCoverageForecast {
  const { plan, inventoryItems, consumptionPayload, horizonDays, now } = input;
  if (horizonDays !== 7 && horizonDays !== 14) {
    return createUnknownMealPlanCoverageForecast(horizonDays, 'invalid_horizon');
  }
  if (!plan.schedule)
    return createUnknownMealPlanCoverageForecast(horizonDays, 'schedule_not_confirmed');
  const schedule = parseStructuredMealPlanSchedule(plan.schedule);
  if (!schedule || !Number.isFinite(now.getTime())) {
    return createUnknownMealPlanCoverageForecast(horizonDays, 'invalid_schedule');
  }

  const today = getLocalDateInTimeZone(now, schedule.timeZone);
  const forecastFromDate = today && schedule.startDate > today ? schedule.startDate : today;
  const throughDateExclusive = forecastFromDate
    ? addCalendarDays(forecastFromDate, horizonDays)
    : null;
  const throughDate = forecastFromDate ? addCalendarDays(forecastFromDate, horizonDays - 1) : null;
  if (!today || !forecastFromDate || !throughDateExclusive || !throughDate) {
    return createUnknownMealPlanCoverageForecast(
      horizonDays,
      'invalid_schedule',
      plan.schedule.timeZone
    );
  }

  const planEndExclusive = addCalendarDays(schedule.startDate, plan.dayCount);
  if (!planEndExclusive || planEndExclusive < throughDateExclusive) {
    return createUnknownMealPlanCoverageForecast(
      horizonDays,
      'plan_does_not_cover_horizon',
      schedule.timeZone,
      forecastFromDate,
      throughDate
    );
  }

  const parsedConsumption = readConsumptionPayload(consumptionPayload, plan, schedule);
  if (!parsedConsumption.valid) {
    return createUnknownMealPlanCoverageForecast(
      horizonDays,
      'invalid_consumption',
      schedule.timeZone,
      forecastFromDate,
      throughDate
    );
  }

  const { requirements, scheduledMealCount, consumedMealCount } = buildRequirements(
    plan,
    forecastFromDate,
    throughDateExclusive,
    parsedConsumption.records
  );
  if (scheduledMealCount === 0) {
    return createUnknownMealPlanCoverageForecast(
      horizonDays,
      'no_future_meals_in_horizon',
      schedule.timeZone,
      forecastFromDate,
      throughDate
    );
  }

  const projection = buildMealPlanInventoryProjection(requirements, inventoryItems);
  const items = markUnquantifiedInventoryUnknown(projection.items, inventoryItems);
  return {
    status: 'ready',
    horizonDays,
    timeZone: schedule.timeZone,
    fromDate: forecastFromDate,
    throughDate,
    scheduledMealCount,
    consumedMealCount,
    items,
    summary: {
      sufficient: items.filter((item) => item.status === 'sufficient').length,
      partial: items.filter((item) => item.status === 'partial').length,
      missing: items.filter((item) => item.status === 'missing').length,
      unknown: items.filter((item) => item.status === 'unknown').length,
    },
  };
}
