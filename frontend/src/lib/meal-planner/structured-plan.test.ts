import { describe, expect, it } from 'vitest';
import {
  parseStructuredMealPlanResponse,
  type StructuredMealType,
} from './structured-plan';
import type { MealPlanPeriod } from './prompt';

function candidate(period: MealPlanPeriod, dayCount: number) {
  const meal = (mealType: StructuredMealType) => ({
    mealType,
    title: `  ${mealType} del día  `,
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
