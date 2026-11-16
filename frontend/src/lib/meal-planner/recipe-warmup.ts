import type { StructuredRecipeIngredient } from '@/lib/recipes/structured-ingredients';
import { StructuredWarmupIngredientSchema } from '@/lib/validation';
import { recipeImportIngredients, renderRecipeDisplay } from '@/lib/recipes/recipe-import';
import {
  createMealPlanWarmupCapability,
  hashCapabilityPayload,
  type MealPlanWarmupCapabilityContext,
} from '@/lib/auth/internal-capability';

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
  recipe_review_required?: true;
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
  actorUserId?: string;
  actorTenantId?: string;
  warmupRequestId?: string;
};

export type WarmupMealPlanResult = {
  calendar: WarmupPlannerDay[];
  failed: number;
  warmedSlots: number;
};

function sanitizeStructuredIngredients(input: unknown): StructuredRecipeIngredient[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 100) return [];
  // Older internal responses may omit nullable fields. Fill only absent
  // values; reject malformed or contradictory evidence rather than erase it.
  const rows = input.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
    return {
      quantity: null,
      unit: null,
      optional_quantity_text: null,
      category: null,
      estimated_cost_optional: null,
      structured: false,
      ...raw,
    };
  });
  const parsed = StructuredWarmupIngredientSchema.array().min(1).max(100).safeParse(rows);
  return parsed.success ? parsed.data : [];
}

function buildRecipeGenerationUrl(origin: string): string {
  return new URL('/api/recipe-generate', origin.replace(/\/$/, '')).toString();
}

export const MAX_WARMUP_GENERATION_SLOTS = 9;

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

      if (warmedSlots + failed >= MAX_WARMUP_GENERATION_SLOTS) {
        failed += 1;
        continue;
      }

      const cleanTitle = meal.name.replace(/\*\*/g, '').trim();
      const generationBody = {
        recipeName: cleanTitle,
        mealType,
        day: dayEntry.day,
        ingredients: [cleanTitle, ...input.inventory.slice(0, 8)].filter(Boolean),
        chunks: meal.rag_context ?? [],
        mode: meal.rag_context?.length ? 'rag' : 'free',
        provider: 'auto',
        culinaryProfile: {
          level: input.culinaryProfile.level,
          preferred: input.culinaryProfile.preferred ?? [],
          avoid: input.culinaryProfile.avoid ?? [],
          goals: input.culinaryProfile.goals ?? [],
          identity: [input.baseCuisine, ...input.fusionCuisines],
        },
        peopleCount: input.peopleCount,
      };
      const jobId =
        input.actorUserId && input.actorTenantId
          ? `warmup:${input.actorTenantId}:${input.actorUserId}:${dayEntry.day}:${mealType}:${crypto.randomUUID()}`
          : undefined;
      const capabilityContext: MealPlanWarmupCapabilityContext | undefined = jobId
        ? {
            method: 'POST',
            path: '/api/recipe-generate',
            operation: 'recipe-generate',
            jobId,
            bodyHash: hashCapabilityPayload(generationBody),
          }
        : undefined;

      try {
        const response = await fetch(buildRecipeGenerationUrl(input.origin), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(capabilityContext && input.actorUserId && input.actorTenantId
              ? {
                  'X-CocinaCore-Warmup-Capability': createMealPlanWarmupCapability(
                    input.actorUserId,
                    input.actorTenantId,
                    capabilityContext
                  ),
                  'X-CocinaCore-Warmup-Job-Id': jobId,
                }
              : {}),
          },
          body: JSON.stringify(generationBody),
        });

        if (!response.ok) {
          failed += 1;
          continue;
        }

        const payload: unknown = await response.json();
        if (!payload || typeof payload !== 'object' || !('recipe' in payload)) {
          failed += 1;
          continue;
        }
        const recipe = typeof payload.recipe === 'string' ? payload.recipe.trim() : '';
        const rawIngredients = 'structuredIngredients' in payload ? payload.structuredIngredients : undefined;
        const ingredients = sanitizeStructuredIngredients(rawIngredients);
        const preparation = 'preparation' in payload ? payload.preparation : undefined;
        const title = 'title' in payload ? payload.title : undefined;
        const consistent = preparation === undefined ||
          (typeof preparation === 'string' && preparation.trim().length > 0 &&
            typeof title === 'string' &&
            renderRecipeDisplay(title, recipeImportIngredients(ingredients), preparation) === recipe);
        if (!recipe || recipe.length > 20_000 || ingredients.length === 0 || !consistent) {
          failed += 1;
          continue;
        }

        hydratedMeals[mealType] = {
          ...meal,
          recipe_content: recipe,
          recipe_review_required: true,
          structured_ingredients: ingredients,
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
