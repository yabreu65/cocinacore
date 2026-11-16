import type { StructuredRecipeIngredient } from '@/components/recipe-view/types';
import { recipeAmountForImport } from './recipe-amount';

export interface RecipeImportPayload {
  title: string;
  instructions: string;
  servings: number;
  ingredients: Array<{
    name: string;
    quantity: string | null;
    unit: string | null;
  }>;
  sourceRecipeHistoryId: string;
}

export interface RecipeImportInput {
  title: string;
  instructions: string;
  servings: number;
  structuredIngredients: readonly StructuredRecipeIngredient[];
  preparation?: string;
  recipeHistoryId: string;
}

/** One representation of the display and the editable ingredient rows.
 * Generated recipes use this exact rendering; legacy text is never parsed
 * or stripped based on a guessed correspondence between ingredient lists.
 */
export function renderRecipeDisplay(
  title: string,
  ingredients: readonly RecipeImportPayload['ingredients'][number][],
  preparation: string
): string {
  return [
    title, '', 'INGREDIENTES',
    ...ingredients.map((item) => '- ' + [
      item.quantity ?? 'cantidad no especificada', item.unit, item.name,
    ].filter((part) => part !== null).join(' ')),
    '', 'PREPARACIÓN', preparation,
  ].join('\n');
}

export function recipePreparationForImport(
  text: string,
  title: string,
  ingredients: readonly RecipeImportPayload['ingredients'][number][],
  preparation: unknown
): string {
  if (typeof preparation !== 'string' || !preparation.trim() ||
      preparation.length > 20_000 || ingredients.length === 0) return text;
  return renderRecipeDisplay(title, ingredients, preparation) === text ? preparation : text;
}

/** Use the same persistent ingredient representation in every recipe boundary. */
export function recipeImportIngredients(items: readonly StructuredRecipeIngredient[]): RecipeImportPayload['ingredients'] {
  return items.map((ingredient) => ({
    name: ingredient.name,
    quantity: recipeAmountForImport(ingredient.quantity, ingredient.exact_quantity_text, ingredient.optional_quantity_text, ingredient.name),
    unit: ingredient.unit,
  }));
}

export function buildRecipeImportPayload(input: RecipeImportInput): RecipeImportPayload {
  const ingredients = recipeImportIngredients(input.structuredIngredients);
  return {
    title: input.title,
    instructions: recipePreparationForImport(input.instructions, input.title, ingredients, input.preparation),
    servings: input.servings,
    ingredients,
    sourceRecipeHistoryId: input.recipeHistoryId,
  };
}
