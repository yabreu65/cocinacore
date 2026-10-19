import type { StructuredRecipeIngredient } from '@/components/recipe-view/types';

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
  recipeHistoryId: string;
}

export function buildRecipeImportPayload(input: RecipeImportInput): RecipeImportPayload {
  return {
    title: input.title,
    instructions: input.instructions,
    servings: input.servings,
    ingredients: input.structuredIngredients.map((ingredient) => ({
      name: ingredient.name,
      quantity: ingredient.quantity === null ? null : String(ingredient.quantity),
      unit: ingredient.unit,
    })),
    sourceRecipeHistoryId: input.recipeHistoryId,
  };
}
