import { describe, expect, it } from 'vitest';
import {
  calculateMealPlanScore,
  compareMealPlans,
  explainOptimization,
  type MealPlanOptimizationScore,
} from './meal-plan-optimizer';
import type { MealPlanInventoryProjection } from './meal-plan-projection';
import type { MealPlanSimulation } from './meal-plan-simulation';
import type { OptimizationMode } from '@/lib/meal-planner/simulation-state';

function buildProjection(input: {
  estimatedCost: number;
  sufficient: number;
  partial: number;
  missing: number;
  unknown: number;
  itemCount?: number;
}): MealPlanInventoryProjection {
  const total = input.itemCount ?? input.sufficient + input.partial + input.missing + input.unknown;
  return {
    items: Array.from({ length: total }).map((_, index) => ({
      ingredientName: `item-${index}`,
      normalizedName: `item-${index}`,
      requiredTotalQuantity: 1,
      requiredUnit: 'unidad',
      availableQuantity: 1,
      availableUnit: 'unidad',
      projectedUsedQuantity: 1,
      projectedRemainingQuantity: 0,
      missingQuantity: 0,
      status:
        index < input.sufficient
          ? 'sufficient'
          : index < input.sufficient + input.partial
            ? 'partial'
            : index < input.sufficient + input.partial + input.missing
              ? 'missing'
              : 'unknown',
      usedInRecipes: [`recipe-${index % 3}`],
      category: 'Despensa',
      estimatedUnitPrice: index % 2 === 0 ? 1.5 : null,
    })),
    summary: {
      sufficient: input.sufficient,
      partial: input.partial,
      missing: input.missing,
      unknown: input.unknown,
      estimatedCost: input.estimatedCost,
    },
  };
}

function buildSimulation(input: {
  reusedIngredients: number;
  critical: number;
  predictions: number;
  duplicatedMeals?: boolean;
  lowCountByDay?: number[];
}): MealPlanSimulation {
  const lowCount = input.lowCountByDay ?? [1, 1, 1];
  const repeatedName = input.duplicatedMeals ? 'Pasta tomate' : undefined;
  return {
    dayStates: ['Lunes', 'Martes', 'Miércoles'].map((day, dayIndex) => ({
      day,
      dayIndex,
      meals: [
        { label: 'Desayuno', title: repeatedName ?? `Desayuno ${day}` },
        { label: 'Almuerzo', title: repeatedName ?? `Almuerzo ${day}` },
        { label: 'Cena', title: repeatedName ?? `Cena ${day}` },
      ],
      ingredients: [],
      summary: {
        consumedCount: 3,
        criticalCount: dayIndex < input.critical ? 1 : 0,
        lowCount: lowCount[dayIndex] ?? 0,
      },
    })),
    predictions: Array.from({ length: input.predictions }, (_, i) => `Predicción ${i + 1}`),
    weeklyCoverage: 70,
    criticalIngredients: Array.from({ length: input.critical }, (_, i) => `critical-${i + 1}`),
    reusedIngredients: Array.from({ length: input.reusedIngredients }, (_, i) => `reuse-${i + 1}`),
    dailyKitchenMessage: 'OK',
  };
}

function score(mode: OptimizationMode, params: {
  estimatedCost: number;
  sufficient: number;
  partial: number;
  missing: number;
  unknown: number;
  reusedIngredients: number;
  critical: number;
  predictions: number;
  duplicatedMeals?: boolean;
  lowCountByDay?: number[];
}): MealPlanOptimizationScore {
  return calculateMealPlanScore(
    buildProjection({
      estimatedCost: params.estimatedCost,
      sufficient: params.sufficient,
      partial: params.partial,
      missing: params.missing,
      unknown: params.unknown,
    }),
    buildSimulation({
      reusedIngredients: params.reusedIngredients,
      critical: params.critical,
      predictions: params.predictions,
      duplicatedMeals: params.duplicatedMeals,
      lowCountByDay: params.lowCountByDay,
    }),
    mode,
  );
}

describe('meal-plan-optimizer scoring coherence', () => {
  it('cost score drops when weekly cost is higher', () => {
    const cheap = score('optimize_cost', {
      estimatedCost: 12,
      sufficient: 7,
      partial: 1,
      missing: 0,
      unknown: 0,
      reusedIngredients: 5,
      critical: 1,
      predictions: 1,
    });
    const expensive = score('optimize_cost', {
      estimatedCost: 68,
      sufficient: 7,
      partial: 1,
      missing: 0,
      unknown: 0,
      reusedIngredients: 5,
      critical: 1,
      predictions: 1,
    });

    expect(cheap.cost).toBeGreaterThan(expensive.cost);
    expect(cheap.total).toBeGreaterThan(expensive.total);
  });

  it('reuse score rises when more ingredients are reused', () => {
    const lowReuse = score('reuse_proteins', {
      estimatedCost: 35,
      sufficient: 5,
      partial: 2,
      missing: 1,
      unknown: 0,
      reusedIngredients: 1,
      critical: 1,
      predictions: 1,
    });
    const highReuse = score('reuse_proteins', {
      estimatedCost: 35,
      sufficient: 5,
      partial: 2,
      missing: 1,
      unknown: 0,
      reusedIngredients: 7,
      critical: 1,
      predictions: 1,
    });

    expect(highReuse.reuse).toBeGreaterThan(lowReuse.reuse);
    expect(highReuse.total).toBeGreaterThan(lowReuse.total);
  });

  it('missing score drops with high missing and unknown items', () => {
    const healthy = score('reduce_missing', {
      estimatedCost: 20,
      sufficient: 8,
      partial: 1,
      missing: 0,
      unknown: 0,
      reusedIngredients: 4,
      critical: 1,
      predictions: 1,
    });
    const risky = score('reduce_missing', {
      estimatedCost: 20,
      sufficient: 2,
      partial: 3,
      missing: 4,
      unknown: 1,
      reusedIngredients: 4,
      critical: 1,
      predictions: 1,
    });

    expect(healthy.missing).toBeGreaterThan(risky.missing);
    expect(healthy.total).toBeGreaterThan(risky.total);
  });

  it('freshness improves when critical/predicted pressure is lower', () => {
    const nearExpiryPressure = score('prioritize_fresh', {
      estimatedCost: 25,
      sufficient: 6,
      partial: 1,
      missing: 1,
      unknown: 0,
      reusedIngredients: 4,
      critical: 4,
      predictions: 4,
      lowCountByDay: [3, 3, 2],
    });
    const stabilized = score('prioritize_fresh', {
      estimatedCost: 25,
      sufficient: 6,
      partial: 1,
      missing: 1,
      unknown: 0,
      reusedIngredients: 4,
      critical: 1,
      predictions: 1,
      lowCountByDay: [0, 1, 0],
    });

    expect(stabilized.freshness).toBeGreaterThan(nearExpiryPressure.freshness);
    expect(stabilized.total).toBeGreaterThan(nearExpiryPressure.total);
  });

  it('balance score drops when meals are repetitive', () => {
    const varied = score('balance_ingredients', {
      estimatedCost: 18,
      sufficient: 7,
      partial: 1,
      missing: 0,
      unknown: 0,
      reusedIngredients: 3,
      critical: 1,
      predictions: 1,
      duplicatedMeals: false,
    });
    const repetitive = score('balance_ingredients', {
      estimatedCost: 18,
      sufficient: 7,
      partial: 1,
      missing: 0,
      unknown: 0,
      reusedIngredients: 3,
      critical: 1,
      predictions: 1,
      duplicatedMeals: true,
    });

    expect(varied.balance).toBeGreaterThan(repetitive.balance);
    expect(varied.total).toBeGreaterThan(repetitive.total);
  });

  it('mode weights prioritize their intended axis', () => {
    const baseParams = {
      estimatedCost: 45,
      sufficient: 5,
      partial: 2,
      missing: 2,
      unknown: 1,
      reusedIngredients: 3,
      critical: 2,
      predictions: 2,
    };

    const costMode = score('optimize_cost', baseParams);
    const missingMode = score('reduce_missing', baseParams);

    expect(costMode.total).not.toBe(missingMode.total);
    expect(costMode.cost).toBeGreaterThan(0);
    expect(missingMode.missing).toBeGreaterThanOrEqual(0);
  });
});

describe('meal-plan-optimizer comparison and explainability', () => {
  it('returns deltas for before/after', () => {
    const before: MealPlanOptimizationScore = {
      cost: 60,
      waste: 63,
      freshness: 55,
      reuse: 50,
      balance: 67,
      missing: 58,
      total: 59,
    };
    const after: MealPlanOptimizationScore = {
      cost: 76,
      waste: 78,
      freshness: 71,
      reuse: 69,
      balance: 70,
      missing: 74,
      total: 73,
    };

    const comparison = compareMealPlans(before, after);
    expect(comparison.deltas.cost).toBe(16);
    expect(comparison.deltas.reuse).toBe(19);
    expect(comparison.deltas.missing).toBe(16);
    expect(comparison.deltas.freshness).toBe(16);
  });

  it('generates non-generic explainability notes by mode', () => {
    const comparison = compareMealPlans(
      { cost: 58, waste: 61, freshness: 54, reuse: 49, balance: 64, missing: 52, total: 57 },
      { cost: 69, waste: 72, freshness: 74, reuse: 58, balance: 65, missing: 64, total: 67 },
    );

    const notes = explainOptimization(comparison, 'prioritize_fresh');

    expect(notes.length).toBeGreaterThan(1);
    expect(notes.some((note) => note.toLowerCase().includes('frescura'))).toBe(true);
    expect(notes.some((note) => note.toLowerCase().includes('ingredientes sensibles'))).toBe(true);
  });
});
