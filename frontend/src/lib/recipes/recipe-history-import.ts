import { recipePreparationForImport, type RecipeImportPayload } from './recipe-import';
import { recipeAmountForImport } from './recipe-amount';
import { normalizeIngredientName } from './ingredient-name';
import { CreatePersistentRecipeSchema } from '@/lib/validation';

interface HistoryImportInput {
  id: string;
  title: string | null;
  payload: unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_HISTORY_IMPORT_INGREDIENTS = 100;

/** Match the persistent recipe's ingredient limit without dropping source rows. */
export function historyImportIngredientLimitExceeded(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const ingredients = (payload as Record<string, unknown>).structuredIngredients;
  return Array.isArray(ingredients) && ingredients.length > MAX_HISTORY_IMPORT_INGREDIENTS;
}

/** Older generated history rows may lack structured metadata; preserve the full text. */
export function buildRecipeImportFromHistory({
  id,
  title,
  payload,
}: HistoryImportInput): RecipeImportPayload | null {
  if (!UUID.test(id) || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  if (historyImportIngredientLimitExceeded(payload)) return null;
  const record = payload as Record<string, unknown>;
  const name =
    typeof record.title === 'string' && record.title.trim()
      ? record.title.trim()
      : typeof title === 'string'
        ? title.trim()
        : '';
  const instructions = typeof record.full_recipe === 'string' ? record.full_recipe.trim() : '';
  if (!name || name.length > 200 || !instructions || instructions.length > 20_000) return null;

  const peopleCount = record.peopleCount ?? 4;
  if (typeof peopleCount !== 'number' || !Number.isInteger(peopleCount) ||
      peopleCount < 1 || peopleCount > 100) return null;
  const ingredients: RecipeImportPayload['ingredients'] = [];
  let completeAmounts = true;
  if (record.structuredIngredients != null && !Array.isArray(record.structuredIngredients)) return null;
  if (Array.isArray(record.structuredIngredients)) {
    for (const raw of record.structuredIngredients) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const ingredient = raw as Record<string, unknown>;
      const ingredientName = typeof ingredient.name === 'string' ? ingredient.name.trim() : '';
      if (!ingredientName || ingredientName.length > 200) return null;
      if (ingredient.unit != null && (typeof ingredient.unit !== 'string' ||
          ingredient.unit.trim().length > 50)) return null;
      const unit = typeof ingredient.unit === 'string' ? ingredient.unit.trim() || null : null;
      const quantity = recipeAmountForImport(ingredient.quantity, ingredient.exact_quantity_text, ingredient.optional_quantity_text, ingredientName);
      if (quantity === null) {
        // The old parser duplicated an ingredient label as its note. This
        // is not an amount; retain the complete original text in that case.
        const duplicateLegacyLabel = ingredient.quantity == null &&
          ingredient.exact_quantity_text === undefined &&
          typeof ingredient.optional_quantity_text === 'string' &&
          normalizeIngredientName(ingredient.optional_quantity_text) === normalizeIngredientName(ingredientName);
        if (duplicateLegacyLabel) completeAmounts = false;
        else if (ingredient.quantity != null || ingredient.exact_quantity_text !== undefined ||
            ingredient.optional_quantity_text != null) return null;
      }
      ingredients.push({ name: ingredientName, quantity, unit });
    }
  }
  const candidate: RecipeImportPayload = {
    title: name,
    instructions: completeAmounts && Array.isArray(record.structuredIngredients)
      ? recipePreparationForImport(instructions, name, ingredients, record.preparation)
      : instructions,
    servings: peopleCount,
    ingredients,
    sourceRecipeHistoryId: id,
  };
  return CreatePersistentRecipeSchema.safeParse(candidate).success ? candidate : null;
}
