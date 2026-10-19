import { NextResponse } from 'next/server';
import type {
  UserRecipeDetailDto,
  UserRecipeListDto,
  UserRecipeVersionRow,
} from '@/lib/db/types';

export interface PublicRecipeVersion {
  id: string;
  version_number: number;
  title: string;
  instructions: string;
  servings: number | null;
  ingredients: UserRecipeVersionRow['ingredients'];
  source_recipe_history_id: string | null;
  created_at: string;
}

export interface PublicRecipe {
  id: string;
  category: string | null;
  tags: string[];
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  current_version: PublicRecipeVersion;
}

export interface PublicRecipeListItem extends Omit<PublicRecipe, 'current_version'> {
  current_version: Pick<PublicRecipeVersion, 'id' | 'version_number' | 'title' | 'instructions' | 'servings' | 'ingredients' | 'created_at'>;
}

function toPublicIngredients(ingredients: UserRecipeVersionRow['ingredients']): UserRecipeVersionRow['ingredients'] {
  return ingredients.map(({ name, quantity = null, unit = null }) => ({ name, quantity, unit }));
}

export function toPublicRecipeVersion(version: UserRecipeVersionRow): PublicRecipeVersion {
  return {
    id: version.id,
    version_number: version.version_number,
    title: version.title,
    instructions: version.instructions,
    servings: version.servings,
    ingredients: toPublicIngredients(version.ingredients),
    source_recipe_history_id: version.source_recipe_history_id,
    created_at: version.created_at,
  };
}

export function toPublicRecipe(recipe: UserRecipeDetailDto): PublicRecipe {
  return {
    id: recipe.id,
    category: recipe.category,
    tags: recipe.tags,
    archived_at: recipe.archived_at,
    created_at: recipe.created_at,
    updated_at: recipe.updated_at,
    current_version: toPublicRecipeVersion(recipe.current_version),
  };
}

export function toPublicRecipeListItem(recipe: UserRecipeListDto): PublicRecipeListItem {
  return {
    id: recipe.id,
    category: recipe.category,
    tags: recipe.tags,
    archived_at: recipe.archived_at,
    created_at: recipe.created_at,
    updated_at: recipe.updated_at,
    current_version: {
      id: recipe.current_version.id,
      version_number: recipe.current_version.version_number,
      title: recipe.current_version.title,
      instructions: recipe.current_version.instructions,
      servings: recipe.current_version.servings,
      ingredients: toPublicIngredients(recipe.current_version.ingredients),
      created_at: recipe.current_version.created_at,
    },
  };
}


export function unauthorizedResponse(error: unknown): NextResponse | null {
  return error instanceof Error && error.message === 'Unauthorized'
    ? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    : null;
}

export function recipeErrorResponse(error: unknown, operation: string): NextResponse {
  if (
    error instanceof Error &&
    error.name === 'RecipeRepositoryError' &&
    'code' in error &&
    error.code === 'conflict'
  ) {
    return NextResponse.json({ error: 'Recipe conflict' }, { status: 409 });
  }
  return NextResponse.json({ error: `Unable to ${operation} recipe` }, { status: 500 });
}
