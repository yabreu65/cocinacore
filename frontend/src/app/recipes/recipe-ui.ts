import { recipePortionFactor } from '@/lib/inventory/portion-scaling';
import {
  exactQuantityText,
  multiplyQuantity,
  parseExactQuantity,
  formatExactQuantityEvidence,
} from '@/lib/inventory/exact-quantity';
import { parseExactStoredQuantity } from '@/lib/inventory/quantity-normalization';
import {
  groupRequirementsByIngredient,
  extractRecipeRequirements,
} from '@/lib/inventory/recipe-requirements';
import { costRecipePortions, type InventoryCostLot } from '@/lib/inventory/inventory-costing';
import type { InventoryCurrency } from '@/lib/inventory/inventory-price';

export type Ingredient = { name: string; quantity?: string | null; unit?: string | null };
export type RecipeVersion = {
  id: string;
  version_number: number;
  title: string;
  instructions: string;
  servings: number | null;
  ingredients: Ingredient[];
  source_recipe_history_id?: string | null;
  created_at?: string;
};
export type Recipe = {
  id: string;
  category: string | null;
  tags: string[];
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  current_version: RecipeVersion;
};
export type DuplicateRecipeCandidate = { recipeId: string; title: string; versionNumber: number };

const recognizedUnits = new Set([
  'g',
  'kg',
  'mg',
  'ml',
  'l',
  'tsp',
  'tbsp',
  'cup',
  'cups',
  'oz',
  'lb',
  'unit',
  'units',
  'clove',
  'cloves',
  'taza',
  'tazas',
  'cucharada',
  'cucharadas',
  'cucharadita',
  'cucharaditas',
  'unidad',
  'unidades',
  'pieza',
  'piezas',
  'diente',
  'dientes',
  'pizca',
  'pizcas',
]);

function recipeRequirements(ingredients: Ingredient[]) {
  return groupRequirementsByIngredient(extractRecipeRequirements(ingredients));
}

export function scaleIngredients(
  ingredients: Ingredient[],
  fromServings: number,
  toServings: number
) {
  const factor = recipePortionFactor(fromServings, toServings);
  if (!factor) return { ingredients, partial: true };
  let partial = false;
  // Preserve the original order and each preparation's ingredient amount.
  // Grouping is for costs/requirements only, never for the recipe display.
  const scaled = ingredients.map((ingredient) => {
    const quantity = ingredient.quantity?.trim() ?? '';
    const unit = ingredient.unit?.trim().toLowerCase() ?? '';
    if (!quantity) {
      if (fromServings !== toServings) partial = true;
      return ingredient;
    }
    const stored = parseExactStoredQuantity({ quantity, unit: ingredient.unit ?? null });
    // Preserve existing support for culinary units that are not stock units.
    const exact =
      stored?.quantity ?? (recognizedUnits.has(unit) ? parseExactQuantity(quantity) : null);
    if (!exact || exact.numerator <= BigInt(0)) {
      partial = true;
      return ingredient;
    }
    const text = exactQuantityText(multiplyQuantity(exact, factor));
    if (text.length > 100) {
      partial = true;
      return ingredient;
    }
    return {
      ...ingredient,
      quantity: text,
      ...(stored && !parseExactQuantity(quantity) ? { unit: stored.unit } : {}),
    };
  });
  return { ingredients: scaled, partial };
}

export function recipePortionCost(
  ingredients: Ingredient[],
  baseServings: number,
  targetServings: number,
  lots: readonly InventoryCostLot[],
  currency: InventoryCurrency | null
) {
  const requirements = recipeRequirements(ingredients).map((item) => ({
    ingredientName: item.ingredientName,
    quantity: formatExactQuantityEvidence(item.requiredQuantity, item.exactQuantityBasis),
    unit: item.requiredUnit,
  }));
  return costRecipePortions({
    requirements,
    recipeServings: baseServings,
    requestedServings: recipePortionFactor(baseServings, targetServings) ? targetServings : 0,
    lots,
    currency,
  });
}

export function filterRecipes(recipes: Recipe[], search: string, category: string, tag: string) {
  const term = search.trim().toLocaleLowerCase();
  return recipes.filter((recipe) => {
    const version = recipe.current_version;
    return (
      (!term ||
        [
          version.title,
          recipe.category ?? '',
          ...recipe.tags,
          ...version.ingredients.map((item) => item.name),
        ].some((value) => value.toLocaleLowerCase().includes(term))) &&
      (category === 'all' || recipe.category === category) &&
      (tag === 'all' || recipe.tags.includes(tag))
    );
  });
}

export function ingredientSummary(ingredients: Ingredient[]) {
  return (
    ingredients
      .slice(0, 3)
      .map(({ name, quantity, unit }) => [quantity, unit, name].filter(Boolean).join(' '))
      .join(', ') || 'Sin ingredientes'
  );
}
