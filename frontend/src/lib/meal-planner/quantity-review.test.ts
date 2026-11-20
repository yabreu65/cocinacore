import { describe, expect, it } from 'vitest';
import { missingQuantityItems, quantityReviewItemsSchema, validateReviewItems } from './quantity-review';
import type { StructuredMealPlan } from './structured-plan';

function sample(): StructuredMealPlan {
  return { period: 'week', dayCount: 7, days: Array.from({ length: 7 }, (_, index) => ({
    dayIndex: index + 1, label: `Day ${index + 1}`, meals: (['breakfast', 'lunch', 'dinner'] as const).map(mealType => ({
      mealType, title: mealType, description: null,
      ingredients: Array.from({ length: 11 }, (_, ingredientIndex) => ({ name: `Ingredient ${index}-${mealType}-${ingredientIndex}`, quantity: null, unit: null })),
    })),
  })) };
}
function proposals(plan: StructuredMealPlan) {
  return missingQuantityItems(plan).map(item => ({ ...item, quantity: 100, unit: 'g' }));
}

describe('quantity review validation', () => {
  it('validates a full weekly response with 231 distinct occurrences', () => {
    const plan = sample(); const items = proposals(plan);
    expect(items).toHaveLength(231);
    expect(validateReviewItems(plan, items.slice(0, 223), false)).toBe(true);
    expect(quantityReviewItemsSchema.safeParse(items).success).toBe(true);
    expect(validateReviewItems(plan, items, true)).toBe(true);
    expect(validateReviewItems(plan, items.slice(0, 1), false)).toBe(true);
    expect(validateReviewItems(plan, items.slice(0, 1), true)).toBe(false);
  });
  it('validates a complete single-day response without accepting other days', () => {
    const plan = sample();
    const firstDay = proposals(plan).filter(item => item.dayIndex === 1);
    expect(firstDay).toHaveLength(33);
    expect(validateReviewItems(plan, firstDay, true, 1)).toBe(true);
    expect(validateReviewItems(plan, firstDay.slice(0, 32), true, 1)).toBe(false);
    expect(validateReviewItems(plan, [...firstDay.slice(0, 32), proposals(plan).find(item => item.dayIndex === 2)!], true, 1)).toBe(false);
  });
  it('rejects duplicates, forged names and indexes', () => {
    const plan = sample(); const items = proposals(plan);
    expect(validateReviewItems(plan, [items[0], items[0]], false)).toBe(false);
    expect(validateReviewItems(plan, [{ ...items[0], name: 'forged' }], false)).toBe(false);
    expect(validateReviewItems(plan, [{ ...items[0], ingredientIndex: 29 }], false)).toBe(false);
  });
  it('rejects malformed, negative, extreme, and unsupported amounts', () => {
    const item = proposals(sample())[0];
    for (const invalid of [{ quantity: -1 }, { quantity: 100001 }, { quantity: Infinity }, { unit: 'tomate' }, { unit: null }]) {
      expect(quantityReviewItemsSchema.safeParse([{ ...item, ...invalid }]).success).toBe(false);
    }
    expect(quantityReviewItemsSchema.safeParse([{ ...item, quantity: null, unit: null }]).success).toBe(true);
  });
  it('preserves known and partial components', () => {
    const plan = sample();
    plan.days[0].meals[0].ingredients[0] = { name: 'Known', quantity: 2, unit: 'kg' };
    plan.days[0].meals[0].ingredients[1] = { name: 'Partial', quantity: 2, unit: null };
    plan.days[0].meals[0].ingredients[2] = { name: 'Unit', quantity: null, unit: 'kg' };
    expect(validateReviewItems(plan, [{ dayIndex: 1, mealType: 'breakfast', ingredientIndex: 0, name: 'Known', quantity: 2, unit: 'kg' }], false)).toBe(false);
    expect(validateReviewItems(plan, [{ dayIndex: 1, mealType: 'breakfast', ingredientIndex: 1, name: 'Partial', quantity: 3, unit: 'kg' }], false)).toBe(false);
    expect(validateReviewItems(plan, [{ dayIndex: 1, mealType: 'breakfast', ingredientIndex: 2, name: 'Unit', quantity: 3, unit: 'g' }], false)).toBe(false);
    expect(validateReviewItems(plan, [{ dayIndex: 1, mealType: 'breakfast', ingredientIndex: 2, name: 'Unit', quantity: 3, unit: 'kilos' }], false)).toBe(true);
  });
});
