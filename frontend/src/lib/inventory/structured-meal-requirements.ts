import type { StructuredMealPlan, StructuredMealType } from '@/lib/meal-planner/structured-plan';
import { mealConsumptionKey } from '@/lib/meal-planner/consumption';
import { normalizeRecipeIngredient, type RecipeRequirement } from './recipe-requirements';

const MEAL_LABELS: Record<StructuredMealType, string> = {
  breakfast: 'Desayuno',
  lunch: 'Almuerzo',
  dinner: 'Cena',
};

/** Converts a canonical persisted plan into the shared requirement engine's input. */
export function structuredMealPlanToRequirements(
  plan: StructuredMealPlan,
  consumedMealKeys: ReadonlySet<string> = new Set()
): RecipeRequirement[] {
  const requirements: RecipeRequirement[] = [];

  for (const day of plan.days) {
    for (const meal of day.meals) {
      if (consumedMealKeys.has(mealConsumptionKey(day.dayIndex, meal.mealType))) continue;
      const provenance = `${day.label} · ${MEAL_LABELS[meal.mealType]} · ${meal.title}`;
      for (const ingredient of meal.ingredients) {
        const normalized = normalizeRecipeIngredient(ingredient);
        if (!normalized) continue;
        requirements.push({
          ...normalized,
          requiredUnit: ingredient.unit === null ? 'unknown' : normalized.requiredUnit,
          usedInRecipes: [provenance],
        });
      }
    }
  }

  return requirements;
}
