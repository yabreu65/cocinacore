import { z } from 'zod';
import { normalizeExplicitUnit } from '@/lib/inventory/quantity-normalization';
import type { StructuredMealPlan } from './structured-plan';

const identity = {
  dayIndex: z.number().int().min(1).max(7),
  mealType: z.enum(['breakfast', 'lunch', 'dinner']),
  ingredientIndex: z.number().int().min(0).max(29),
  name: z.string().min(1).max(120),
};
export const quantityReviewItemSchema = z.object({
  ...identity,
  quantity: z.number().finite().positive().max(100000).nullable(),
  unit: z.string().min(1).max(40).nullable(),
}).strict().superRefine((item, ctx) => {
  if ((item.quantity === null) !== (item.unit === null) ||
      (item.unit !== null && normalizeExplicitUnit(item.unit) === 'unknown')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid amount and unit' });
  }
});
export type QuantityReviewItem = z.infer<typeof quantityReviewItemSchema>;
export const quantityReviewItemsSchema = z.array(quantityReviewItemSchema).min(1).max(630);

export function missingQuantityItems(plan: StructuredMealPlan) {
  return plan.days.flatMap(day => day.meals.flatMap(meal => meal.ingredients.flatMap((ingredient, ingredientIndex) =>
    ingredient.quantity === null || !ingredient.unit || normalizeExplicitUnit(ingredient.unit) === 'unknown'
      ? [{ dayIndex: day.dayIndex, mealType: meal.mealType, ingredientIndex, name: ingredient.name,
          quantity: ingredient.quantity, unit: ingredient.unit }]
      : [])));
}

/** Exact positional and name matching; never replace any previously known component. */
export function validateReviewItems(plan: StructuredMealPlan, items: QuantityReviewItem[], complete: boolean): boolean {
  const missing = missingQuantityItems(plan);
  if (complete && items.length !== missing.length) return false;
  const seen = new Set<string>();
  return items.every(item => {
    const key = `${item.dayIndex}:${item.mealType}:${item.ingredientIndex}`;
    if (seen.has(key)) return false;
    seen.add(key);
    const original = missing.find(candidate => candidate.dayIndex === item.dayIndex &&
      candidate.mealType === item.mealType && candidate.ingredientIndex === item.ingredientIndex);
    if (!original || original.name !== item.name) return false;
    if (item.quantity === null) return true;
    // Existing values are immutable; incompatible partial evidence is rejected.
    if (original.quantity !== null && original.quantity !== item.quantity) return false;
    if (original.unit && normalizeExplicitUnit(original.unit) !== 'unknown' &&
        normalizeExplicitUnit(original.unit) !== normalizeExplicitUnit(item.unit)) return false;
    return true;
  });
}
