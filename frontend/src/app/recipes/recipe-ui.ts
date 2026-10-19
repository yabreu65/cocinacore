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

export function scaleIngredients(
  ingredients: Ingredient[],
  fromServings: number,
  toServings: number
) {
  if (fromServings <= 0 || toServings <= 0) return { ingredients, partial: false };
  const factor = toServings / fromServings;
  let partial = false;
  const scaled = ingredients.map((ingredient) => {
    const quantity = ingredient.quantity?.trim() ?? '';
    const unit = ingredient.unit?.trim().toLowerCase() ?? '';
    if (!quantity) return ingredient;
    const numeric = /^\d+(?:\.\d+)?$/.test(quantity);
    if (!numeric || !recognizedUnits.has(unit)) {
      partial = true;
      return ingredient;
    }
    const value = Number(quantity) * factor;
    return { ...ingredient, quantity: Number(value.toFixed(2)).toString() };
  });
  return { ingredients: scaled, partial };
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
