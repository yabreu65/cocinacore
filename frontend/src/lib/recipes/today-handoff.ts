import type { RecipeGenerateSchema } from '../validation';
import type { z } from 'zod';

export type TodayHandoffSlot = 'breakfast' | 'lunch' | 'snack' | 'dinner';

export interface TodayHandoff {
  slot: TodayHandoffSlot;
  title: string;
  ingredients: string[];
  targetServings?: number;
}

export interface TodayRecipeRequestFields {
  recipeName: string;
  mealType: string;
  ingredients: string[];
  targetServings?: number;
}

export interface RecipeGenerationRequestInput {
  mode: 'free' | 'rag';
  ingredients: string;
  recipeName: string;
  restrictions: string;
  todayFields: TodayRecipeRequestFields | null;
}

export function buildRecipeGenerationRequestPayload(
  input: RecipeGenerationRequestInput,
): z.input<typeof RecipeGenerateSchema> {
  const dietaryRules = input.restrictions.split(',').map((rule) => rule.trim()).filter(Boolean);

  return {
    mode: input.mode,
    ingredients: input.ingredients.split('\n').map((ingredient) => ingredient.trim()).filter(Boolean),
    ...(input.recipeName.trim() ? { recipeName: input.recipeName.trim() } : {}),
    ...(input.todayFields ? { mealType: input.todayFields.mealType } : {}),
    peopleCount: input.todayFields?.targetServings ?? 4,
    culinaryProfile: {
      level: 'Intermedio',
      identity: [],
      preferred: [],
      avoid: dietaryRules,
      goals: [],
    },
  };
}

const MAX_RECIPE_NAME_LENGTH = 200;
const MAX_INGREDIENT_LENGTH = 100;
const MAX_INGREDIENT_COUNT = 30;

const mealTypes: Record<TodayHandoffSlot, string> = {
  breakfast: 'Desayuno',
  lunch: 'Almuerzo',
  snack: 'Merienda',
  dinner: 'Cena',
};

function isTodaySlot(value: string): value is TodayHandoffSlot {
  return value === 'breakfast' || value === 'lunch' || value === 'snack' || value === 'dinner';
}

// Accept only explicit meal labels already used by the planner and Today.
export function todaySlotForMealType(value: string): TodayHandoffSlot | undefined {
  const key = value.trim().toLowerCase();
  if (isTodaySlot(key)) return key;
  return (Object.keys(mealTypes) as TodayHandoffSlot[]).find((slot) => mealTypes[slot].toLowerCase() === key);
}

export function parseTodayHandoff(params: URLSearchParams): (TodayHandoff & TodayRecipeRequestFields) | null {
  const slot = params.get('slot');
  const title = params.get('title')?.trim() ?? '';
  const rawTargetServings = params.get('servings');
  const targetServings = rawTargetServings === null ? undefined : Number(rawTargetServings);
  if (
    (targetServings !== undefined && (!Number.isInteger(targetServings) || targetServings < 1 || targetServings > 100)) ||
    !slot ||
    !isTodaySlot(slot) ||
    !title ||
    title.length > MAX_RECIPE_NAME_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(title)
  ) return null;

  const ingredients: string[] = [];
  let rawIngredientCount = 0;
  for (const [name, value] of params.entries()) {
    if (name !== 'ingredient') continue;

    // Invalid values still count toward this raw scan bound.
    rawIngredientCount += 1;
    const ingredient = value.trim();
    if (
      ingredient.length > 0 &&
      ingredient.length <= MAX_INGREDIENT_LENGTH &&
      !/[\u0000-\u001f\u007f]/.test(ingredient)
    ) {
      ingredients.push(ingredient);
    }
    if (rawIngredientCount === MAX_INGREDIENT_COUNT) break;
  }

  return {
    slot,
    title,
    ingredients,
    recipeName: title,
    mealType: mealTypes[slot],
    ...(targetServings === undefined ? {} : { targetServings }),
  };
}

export function buildTodayRecipeRequestFields(params: URLSearchParams): TodayRecipeRequestFields | null {
  const handoff = parseTodayHandoff(params);
  if (!handoff) return null;
  return {
    recipeName: handoff.recipeName,
    mealType: handoff.mealType,
    ingredients: handoff.ingredients,
    ...(handoff.targetServings === undefined ? {} : { targetServings: handoff.targetServings }),
  };
}

export function serializeTodayHandoff(option: TodayHandoff): string {
  const params = new URLSearchParams();
  params.set('slot', option.slot);
  params.set('title', option.title);
  option.ingredients.forEach((ingredient) => params.append('ingredient', ingredient));
  if (option.targetServings !== undefined) params.set('servings', String(option.targetServings));
  return `/recipes/search?${params.toString()}`;
}
