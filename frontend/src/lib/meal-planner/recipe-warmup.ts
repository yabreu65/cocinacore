import type { StructuredRecipeIngredient } from '@/lib/recipes/structured-ingredients';

export type WarmupMealType = 'Desayuno' | 'Almuerzo' | 'Cena';

export type WarmupMealCard = {
  name: string;
  time: string;
  difficulty: 'Fácil' | 'Media' | 'Alta';
  badge: string;
  fusionTag: string;
  missing: number;
  aiScore: number;
  structured_ingredients?: StructuredRecipeIngredient[];
  recipe_content?: string | null;
  rag_context?: string[];
};

export type WarmupPlannerDay = {
  day: string;
  meals: Record<WarmupMealType, WarmupMealCard>;
};

export type WarmupMealPlanInput = {
  origin: string;
  calendar: WarmupPlannerDay[];
  targetDays: string[];
  inventory: string[];
  baseCuisine: string;
  fusionCuisines: string[];
  peopleCount: number;
  culinaryProfile: {
    level?: string | null;
    preferred?: string[];
    avoid?: string[];
    goals?: string[];
  };
};

export type WarmupMealPlanResult = {
  calendar: WarmupPlannerDay[];
  failed: number;
  warmedSlots: number;
};

function sanitizeStructuredIngredients(input: unknown): StructuredRecipeIngredient[] {
  if (!Array.isArray(input)) return [];

  return input
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      name: typeof item.name === 'string' ? item.name : '',
      normalized_name: typeof item.normalized_name === 'string' ? item.normalized_name : '',
      quantity:
        typeof item.quantity === 'number' && Number.isFinite(item.quantity) ? item.quantity : null,
      unit: typeof item.unit === 'string' ? item.unit : null,
      optional_quantity_text:
        typeof item.optional_quantity_text === 'string' ? item.optional_quantity_text : null,
      category: typeof item.category === 'string' ? item.category : null,
      estimated_cost_optional:
        typeof item.estimated_cost_optional === 'number' &&
        Number.isFinite(item.estimated_cost_optional)
          ? item.estimated_cost_optional
          : null,
      structured: Boolean(item.structured),
    }))
    .filter((item) => item.name.length > 0 && item.normalized_name.length > 0);
}

function buildRecipeGenerationUrl(origin: string): string {
  return new URL('/api/recipe-generate', origin.replace(/\/$/, '')).toString();
}

export async function hydrateMealPlanWarmup(
  input: WarmupMealPlanInput
): Promise<WarmupMealPlanResult> {
  const targetDays = new Set(input.targetDays.map((day) => day.trim()).filter(Boolean));
  const hydratedCalendar: WarmupPlannerDay[] = [];
  let failed = 0;
  let warmedSlots = 0;

  for (const dayEntry of input.calendar) {
    const hydratedMeals = { ...dayEntry.meals };

    if (!targetDays.has(dayEntry.day)) {
      hydratedCalendar.push({
        ...dayEntry,
        meals: hydratedMeals,
      });
      continue;
    }

    for (const mealType of Object.keys(hydratedMeals) as WarmupMealType[]) {
      const meal = hydratedMeals[mealType];
      const alreadyHasContent =
        typeof meal.recipe_content === 'string' && meal.recipe_content.trim().length > 0;
      if (alreadyHasContent) continue;

      const cleanTitle = meal.name.replace(/\*\*/g, '').trim();

      try {
        const response = await fetch(buildRecipeGenerationUrl(input.origin), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipeName: cleanTitle,
            mealType,
            day: dayEntry.day,
            ingredients: [cleanTitle, ...input.inventory.slice(0, 8)],
            chunks: meal.rag_context ?? [],
            mode: meal.rag_context?.length ? 'rag' : 'free',
            culinaryProfile: {
              level: input.culinaryProfile.level,
              preferred: input.culinaryProfile.preferred ?? [],
              avoid: input.culinaryProfile.avoid ?? [],
              goals: input.culinaryProfile.goals ?? [],
              identity: [input.baseCuisine, ...input.fusionCuisines],
            },
            peopleCount: input.peopleCount,
          }),
        });

        if (!response.ok) {
          failed += 1;
          continue;
        }

        const payload = (await response.json()) as {
          recipe?: string;
          structuredIngredients?: StructuredRecipeIngredient[];
        };

        const recipe = payload.recipe?.trim();
        if (!recipe) {
          failed += 1;
          continue;
        }

        hydratedMeals[mealType] = {
          ...meal,
          recipe_content: recipe,
          structured_ingredients: sanitizeStructuredIngredients(payload.structuredIngredients),
        };
        warmedSlots += 1;
      } catch {
        failed += 1;
      }
    }

    hydratedCalendar.push({
      ...dayEntry,
      meals: hydratedMeals,
    });
  }

  return {
    calendar: hydratedCalendar,
    failed,
    warmedSlots,
  };
}
