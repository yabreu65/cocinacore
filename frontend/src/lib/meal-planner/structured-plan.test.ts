import { describe, expect, it } from 'vitest';
import {
  parseStructuredMealPlanResponse,
  parseStructuredMealPlanValue,
  type StructuredMealType,
} from './structured-plan';
import type { MealPlanPeriod } from './prompt';

function candidate(period: MealPlanPeriod, dayCount: number) {
  const meal = (mealType: StructuredMealType) => ({
    mealType,
    title: `  ${mealType} del día  `,
    prepMinutes: 20,
    description: '  Preparación simple  ',
    ingredients: [{ name: '  Arroz integral  ', quantity: 1 as number | null, unit: ' taza '}],
  });

  return {
    period,
    dayCount,
    days: Array.from({ length: dayCount }, (_, index) => ({
      dayIndex: index + 1,
      meals: [meal('breakfast'), meal('lunch'), meal('dinner')],
    })),
  };
}

describe('parseStructuredMealPlanResponse', () => {
  it.each([
    ['week', 7],
    ['fortnight', 14],
    ['month', 30],
  ] as const)('accepts a valid %s plan with %i days', (period, dayCount) => {
    const result = parseStructuredMealPlanResponse(JSON.stringify(candidate(period, dayCount)), period);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.plan.dayCount).toBe(dayCount);
    expect(result.plan.days).toHaveLength(dayCount);
    expect(result.plan.days[0].label).toBe(period === 'week' ? 'Lunes' : 'Día 1');
    expect(result.plan.days.at(-1)?.label).toBe(period === 'week' ? 'Domingo' : `Día ${dayCount}`);
    expect(result.plan.days[0].meals.map((meal) => meal.mealType)).toEqual([
      'breakfast',
      'lunch',
      'dinner',
    ]);
  });

  it('requires prepMinutes on every meal', () => {
    const plan = candidate('week', 7);
    delete (plan.days[0].meals[0] as { prepMinutes?: number }).prepMinutes;

    expect(parseStructuredMealPlanResponse(JSON.stringify(plan), 'week')).toEqual({
      success: false,
      reason: 'schema_invalid',
    });
  });

  it.each([0, 241, 1.5])('rejects invalid prepMinutes %s', (prepMinutes) => {
    const plan = candidate('week', 7);
    plan.days[0].meals[0].prepMinutes = prepMinutes;

    expect(parseStructuredMealPlanResponse(JSON.stringify(plan), 'week')).toEqual({
      success: false,
      reason: 'schema_invalid',
    });
  });

  it.each([1, 240])('accepts prepMinutes boundary %i', (prepMinutes) => {
    const plan = candidate('week', 7);
    plan.days[0].meals[0].prepMinutes = prepMinutes;

    expect(parseStructuredMealPlanResponse(JSON.stringify(plan), 'week').success).toBe(true);
  });

  it('rejects a wrong day count', () => {
    const result = parseStructuredMealPlanResponse(JSON.stringify(candidate('week', 6)), 'week');

    expect(result).toEqual({ success: false, reason: 'day_count_mismatch' });
  });

  it('rejects a day missing a required meal', () => {
    const plan = candidate('week', 7);
    plan.days[0].meals.pop();

    expect(parseStructuredMealPlanResponse(JSON.stringify(plan), 'week')).toEqual({
      success: false,
      reason: 'schema_invalid',
    });
  });

  it('rejects an invalid meal type', () => {
    const plan = candidate('week', 7);
    plan.days[0].meals[0].mealType = 'snack' as StructuredMealType;

    expect(parseStructuredMealPlanResponse(JSON.stringify(plan), 'week')).toEqual({
      success: false,
      reason: 'schema_invalid',
    });
  });

  it('rejects malformed and non-JSON responses', () => {
    expect(parseStructuredMealPlanResponse('{not-json}', 'week')).toEqual({
      success: false,
      reason: 'invalid_json',
    });
    expect(parseStructuredMealPlanResponse(JSON.stringify(['not', 'a', 'plan']), 'week')).toEqual({
      success: false,
      reason: 'schema_invalid',
    });
  });

  it('preserves nullable quantities and units while normalizing text', () => {
    const plan = candidate('week', 7);
    const ingredient = plan.days[0].meals[0].ingredients[0];
    ingredient.quantity = null;
    ingredient.unit = '   ';
    plan.days[0].meals[0].description = '   ';

    const result = parseStructuredMealPlanResponse(JSON.stringify(plan), 'week');

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.plan.days[0].meals[0]).toMatchObject({
      title: 'breakfast del día',
      prepMinutes: 20,
      description: null,
      ingredients: [{ name: 'Arroz integral', quantity: null, unit: null }],
    });
  });

  it('rejects empty or oversized normalized fields', () => {
    const oversizedTitlePlan = candidate('week', 7);
    oversizedTitlePlan.days[0].meals[0].title = 'x'.repeat(161);
    const emptyIngredientPlan = candidate('week', 7);
    emptyIngredientPlan.days[0].meals[0].ingredients[0].name = '   ';
    const missingIngredientsPlan = candidate('week', 7);
    missingIngredientsPlan.days[0].meals[0].ingredients = [];

    expect(parseStructuredMealPlanResponse(JSON.stringify(oversizedTitlePlan), 'week')).toEqual({
      success: false,
      reason: 'schema_invalid',
    });
    expect(parseStructuredMealPlanResponse(JSON.stringify(emptyIngredientPlan), 'week')).toEqual({
      success: false,
      reason: 'schema_invalid',
    });
    expect(parseStructuredMealPlanResponse(JSON.stringify(missingIngredientsPlan), 'week')).toEqual({
      success: false,
      reason: 'schema_invalid',
    });
  });

  it('rejects duplicate or missing day indices', () => {
    const duplicateIndexPlan = candidate('week', 7);
    duplicateIndexPlan.days[1].dayIndex = 1;
    const missingIndexPlan = candidate('week', 7);
    missingIndexPlan.days[3].dayIndex = 5;

    expect(parseStructuredMealPlanResponse(JSON.stringify(duplicateIndexPlan), 'week')).toEqual({
      success: false,
      reason: 'day_index_mismatch',
    });
    expect(parseStructuredMealPlanResponse(JSON.stringify(missingIndexPlan), 'week')).toEqual({
      success: false,
      reason: 'day_index_mismatch',
    });
  });
});

describe('parseStructuredMealPlanValue', () => {
  it('accepts a persisted canonical plan and reassigns canonical labels', () => {
    const rawPlan = candidate('week', 7);
    const canonicalPlan = parseStructuredMealPlanResponse(JSON.stringify(rawPlan), 'week');
    if (!canonicalPlan.success) throw new Error('Expected fixture to be valid');

    const result = parseStructuredMealPlanValue(canonicalPlan.plan, 'week');

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.plan.days[0].label).toBe('Lunes');
    expect(result.plan.days.at(-1)?.label).toBe('Domingo');
    expect(result.plan.schedule).toBeUndefined();
  });

  it('preserves explicitly confirmed schedule metadata on persisted plans', () => {
    const rawPlan = {
      ...candidate('week', 7),
      schedule: {
        startDate: '2026-10-26',
        timeZone: 'America/Argentina/Buenos_Aires',
        confirmedAt: '2026-10-25T12:00:00.000Z',
        portionConfirmation: {
          peopleCount: 4,
          confirmedAt: '2026-10-25T12:00:00.000Z',
        },
      },
    };

    const result = parseStructuredMealPlanValue(rawPlan, 'week');

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.plan.schedule).toEqual(rawPlan.schedule);
    expect(result.plan.days[0].label).toBe('Lunes');
  });

  it.each([
    ['invalid calendar date', { startDate: '2026-02-30' }],
    ['invalid IANA timezone', { timeZone: 'Not/A_Timezone' }],
    ['invalid confirmation timestamp', { confirmedAt: '2026-02-30T12:00:00.000Z' }],
  ])('rejects schedule metadata with an %s', (_label, override) => {
    const value = {
      ...candidate('week', 7),
      schedule: {
        startDate: '2026-10-26',
        timeZone: 'UTC',
        confirmedAt: '2026-10-25T12:00:00.000Z',
        ...override,
      },
    };

    expect(parseStructuredMealPlanValue(value, 'week')).toEqual({
      success: false,
      reason: 'schema_invalid',
    });
  });

  it('rejects schedule metadata from the model-generated provider response', () => {
    const value = {
      ...candidate('week', 7),
      schedule: {
        startDate: '2026-10-26',
        timeZone: 'UTC',
        confirmedAt: '2026-10-25T12:00:00.000Z',
      },
    };

    expect(parseStructuredMealPlanResponse(JSON.stringify(value), 'week')).toEqual({
      success: false,
      reason: 'schema_invalid',
    });
  });

  it('accepts historical plans without estimates or a cap snapshot', () => {
    const historical = candidate('week', 7);
    for (const day of historical.days) {
      for (const meal of day.meals) delete (meal as { prepMinutes?: number }).prepMinutes;
    }

    const result = parseStructuredMealPlanValue(historical, 'week');

    expect(result.success).toBe(true);
    if (result.success) expect(result.plan.days[0].meals[0].prepMinutes).toBeNull();
  });

  it('rejects wrong periods and malformed JSONB values', () => {
    expect(parseStructuredMealPlanValue(candidate('fortnight', 14), 'week')).toEqual({
      success: false,
      reason: 'period_mismatch',
    });
    expect(parseStructuredMealPlanValue(['not', 'a', 'plan'], 'week')).toEqual({
      success: false,
      reason: 'schema_invalid',
    });
    expect(
      parseStructuredMealPlanValue(
        {
          ...candidate('week', 7),
          days: candidate('week', 7).days.map((day) => ({ ...day, label: 'not canonical' })),
        },
        'week'
      )
    ).toEqual({ success: false, reason: 'schema_invalid' });
  });
});
