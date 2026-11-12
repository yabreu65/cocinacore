import type { RecipeImportPayload } from './recipe-import';

interface HistoryImportInput {
  id: string;
  title: string | null;
  payload: unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Older generated history rows may lack structured metadata; preserve the full text. */
export function buildRecipeImportFromHistory({
  id,
  title,
  payload,
}: HistoryImportInput): RecipeImportPayload | null {
  if (!UUID.test(id) || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const name =
    typeof record.title === 'string' && record.title.trim()
      ? record.title.trim()
      : typeof title === 'string'
        ? title.trim()
        : '';
  const instructions = typeof record.full_recipe === 'string' ? record.full_recipe.trim() : '';
  if (!name || name.length > 200 || !instructions || instructions.length > 20_000) return null;

  const peopleCount = record.peopleCount;
  const servings =
    typeof peopleCount === 'number' &&
    Number.isInteger(peopleCount) &&
    peopleCount >= 1 &&
    peopleCount <= 100
      ? peopleCount
      : 4;
  const ingredients: RecipeImportPayload['ingredients'] = [];
  if (Array.isArray(record.structuredIngredients)) {
    for (const raw of record.structuredIngredients.slice(0, 100)) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const ingredient = raw as Record<string, unknown>;
      const ingredientName = typeof ingredient.name === 'string' ? ingredient.name.trim() : '';
      if (!ingredientName || ingredientName.length > 200) continue;
      const quantity =
        typeof ingredient.quantity === 'number' &&
        Number.isFinite(ingredient.quantity) &&
        ingredient.quantity >= 0
          ? String(ingredient.quantity)
          : null;
      const unit =
        typeof ingredient.unit === 'string' ? ingredient.unit.trim().slice(0, 50) || null : null;
      ingredients.push({ name: ingredientName, quantity, unit });
    }
  }
  return {
    title: name,
    instructions,
    servings,
    ingredients,
    sourceRecipeHistoryId: id,
  };
}
