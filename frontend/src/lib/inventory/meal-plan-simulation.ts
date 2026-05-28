import type { MealPlanProjectionItem } from './meal-plan-projection';

export type SimulationMeal = {
  label: string;
  title: string;
  time?: string;
  difficulty?: string;
};

export type SimulationDayInput = {
  day: string;
  meals: SimulationMeal[];
};

export type SimulationIngredientState = {
  normalizedName: string;
  ingredientName: string;
  before: number | null;
  consumed: number | null;
  after: number | null;
  unit: string;
  status: 'sufficient' | 'low' | 'critical' | 'unknown';
};

export type SimulationDayState = {
  day: string;
  dayIndex: number;
  meals: SimulationMeal[];
  ingredients: SimulationIngredientState[];
  summary: {
    consumedCount: number;
    criticalCount: number;
    lowCount: number;
  };
};

export type MealPlanSimulation = {
  dayStates: SimulationDayState[];
  predictions: string[];
  weeklyCoverage: number;
  criticalIngredients: string[];
  reusedIngredients: string[];
  dailyKitchenMessage: string;
};

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

function statusFromRatio(value: number | null): 'sufficient' | 'low' | 'critical' | 'unknown' {
  if (value === null) return 'unknown';
  if (value <= 0.25) return 'critical';
  if (value <= 0.5) return 'low';
  return 'sufficient';
}

function inferMealMatches(item: MealPlanProjectionItem, day: SimulationDayInput): number {
  if (item.usedInRecipes.length === 0) return 0;
  const recipeSignals = item.usedInRecipes.map(normalize);
  return day.meals.filter((meal) => {
    const title = normalize(meal.title);
    return recipeSignals.some((signal) => signal.length > 2 && title.includes(signal));
  }).length;
}

export function buildMealPlanSimulation(
  days: SimulationDayInput[],
  projectionItems: MealPlanProjectionItem[],
): MealPlanSimulation {
  if (days.length === 0 || projectionItems.length === 0) {
    return {
      dayStates: [],
      predictions: [],
      weeklyCoverage: 0,
      criticalIngredients: [],
      reusedIngredients: [],
      dailyKitchenMessage: 'Generá un menú para activar la simulación diaria.',
    };
  }

  const totalStructured = projectionItems.filter((item) => item.requiredTotalQuantity !== null && item.availableQuantity !== null);
  const covered = totalStructured.filter((item) => item.status === 'sufficient').length;
  const weeklyCoverage = totalStructured.length === 0 ? 0 : Math.round((covered / totalStructured.length) * 100);

  const perIngredientDayConsumption = new Map<string, number[]>();

  projectionItems.forEach((item) => {
    const required = item.requiredTotalQuantity;
    if (required === null || !Number.isFinite(required) || required <= 0) {
      perIngredientDayConsumption.set(item.normalizedName, Array.from({ length: days.length }, () => 0));
      return;
    }

    const matchCounts = days.map((day) => inferMealMatches(item, day));
    const totalMatches = matchCounts.reduce((acc, curr) => acc + curr, 0);

    const distribution: number[] = totalMatches > 0
      ? matchCounts.map((count) => (count / totalMatches) * required)
      : Array.from({ length: days.length }, () => required / days.length);

    perIngredientDayConsumption.set(
      item.normalizedName,
      distribution.map((qty) => Number(qty.toFixed(2))),
    );
  });

  const dayStates: SimulationDayState[] = [];
  const runningConsumed = new Map<string, number>();

  days.forEach((day, dayIndex) => {
    const ingredients = projectionItems.map((item) => {
      const before = item.availableQuantity;
      const dist = perIngredientDayConsumption.get(item.normalizedName) ?? [];
      const consumeToday = dist[dayIndex] ?? 0;
      const prevConsumed = runningConsumed.get(item.normalizedName) ?? 0;
      const consumed = item.requiredTotalQuantity === null ? null : Number((prevConsumed + consumeToday).toFixed(2));
      if (item.requiredTotalQuantity !== null) {
        runningConsumed.set(item.normalizedName, prevConsumed + consumeToday);
      }

      const after = before === null || consumed === null ? null : Number(Math.max(0, before - consumed).toFixed(2));
      const ratio = before && before > 0 && after !== null ? after / before : null;

      return {
        normalizedName: item.normalizedName,
        ingredientName: item.ingredientName,
        before,
        consumed: consumed === null ? null : Number(Math.min(consumed, item.requiredTotalQuantity ?? consumed).toFixed(2)),
        after,
        unit: item.requiredUnit,
        status: statusFromRatio(ratio),
      } satisfies SimulationIngredientState;
    });

    const criticalCount = ingredients.filter((item) => item.status === 'critical').length;
    const lowCount = ingredients.filter((item) => item.status === 'low').length;

    dayStates.push({
      day: day.day,
      dayIndex,
      meals: day.meals,
      ingredients,
      summary: {
        consumedCount: ingredients.filter((item) => (item.consumed ?? 0) > 0).length,
        criticalCount,
        lowCount,
      },
    });
  });

  const predictions: string[] = [];
  const firstCriticalByIngredient = new Map<string, string>();

  for (const state of dayStates) {
    for (const ingredient of state.ingredients) {
      if (ingredient.status !== 'critical') continue;
      if (!firstCriticalByIngredient.has(ingredient.normalizedName)) {
        firstCriticalByIngredient.set(ingredient.normalizedName, state.day);
      }
    }
  }

  for (const [name, day] of firstCriticalByIngredient.entries()) {
    predictions.push(`Si seguís este menú, ${name} quedará crítico el ${day}.`);
  }

  const criticalIngredients = Array.from(firstCriticalByIngredient.keys()).slice(0, 8);
  const reusedIngredients = projectionItems
    .filter((item) => item.usedInRecipes.length > 1)
    .map((item) => item.ingredientName)
    .slice(0, 8);

  const today = dayStates[0];
  const dailyKitchenMessage =
    today.summary.criticalCount > 0
      ? 'Hoy tu cocina necesita atención: hay ingredientes críticos en la simulación.'
      : today.summary.lowCount > 0
        ? 'Tu cocina está estable, pero algunos ingredientes quedarán bajos pronto.'
        : 'Tu cocina está bien abastecida para iniciar el menú.';

  return {
    dayStates,
    predictions,
    weeklyCoverage,
    criticalIngredients,
    reusedIngredients,
    dailyKitchenMessage,
  };
}
