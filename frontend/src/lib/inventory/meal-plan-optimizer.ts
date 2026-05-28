import type { MealPlanInventoryProjection } from './meal-plan-projection';
import type { MealPlanSimulation } from './meal-plan-simulation';
import type { OptimizationMode } from '@/lib/meal-planner/simulation-state';

export type MealPlanOptimizationScore = {
  cost: number;
  waste: number;
  freshness: number;
  reuse: number;
  balance: number;
  missing: number;
  total: number;
};

export type MealPlanComparison = {
  before: MealPlanOptimizationScore;
  after: MealPlanOptimizationScore;
  deltas: {
    cost: number;
    reuse: number;
    missing: number;
    freshness: number;
  };
};

type ScoreWeights = {
  cost: number;
  waste: number;
  freshness: number;
  reuse: number;
  balance: number;
  missing: number;
};

const MODE_WEIGHTS: Record<OptimizationMode, ScoreWeights> = {
  optimize_cost: { cost: 0.48, waste: 0.12, freshness: 0.1, reuse: 0.1, balance: 0.07, missing: 0.13 },
  reduce_waste: { cost: 0.1, waste: 0.36, freshness: 0.2, reuse: 0.22, balance: 0.04, missing: 0.08 },
  prioritize_fresh: { cost: 0.08, waste: 0.16, freshness: 0.48, reuse: 0.08, balance: 0.08, missing: 0.12 },
  reduce_missing: { cost: 0.1, waste: 0.08, freshness: 0.08, reuse: 0.08, balance: 0.06, missing: 0.6 },
  reuse_proteins: { cost: 0.16, waste: 0.22, freshness: 0.12, reuse: 0.38, balance: 0.04, missing: 0.08 },
  balance_ingredients: { cost: 0.08, waste: 0.1, freshness: 0.12, reuse: 0.15, balance: 0.45, missing: 0.1 },
};

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function computeBalanceScore(simulation: MealPlanSimulation): number {
  const mealNames = simulation.dayStates.flatMap((day) => day.meals.map((meal) => meal.title.toLowerCase().trim()));
  if (mealNames.length <= 1) return 100;

  const uniqueRatio = new Set(mealNames).size / mealNames.length;
  let repetition = 0;
  for (let i = 1; i < mealNames.length; i += 1) {
    if (mealNames[i] === mealNames[i - 1]) repetition += 1;
  }
  const sequencePenalty = (repetition / (mealNames.length - 1)) * 100;
  const varietyScore = uniqueRatio * 100;
  return clamp(varietyScore - sequencePenalty * 0.5);
}

function computeCostScore(projection: MealPlanInventoryProjection): number {
  const estimatedCost = projection.summary.estimatedCost;
  const missingLoad = projection.summary.missing * 8 + projection.summary.partial * 4 + projection.summary.unknown * 3;
  return clamp(100 - estimatedCost * 1.6 - missingLoad);
}

function computeWasteScore(projection: MealPlanInventoryProjection, simulation: MealPlanSimulation): number {
  const totalItems = Math.max(1, projection.items.length);
  const reuseRatio = simulation.reusedIngredients.length / totalItems;
  const missingRatio = (projection.summary.missing + projection.summary.partial) / totalItems;
  const unknownRatio = projection.summary.unknown / totalItems;

  return clamp(reuseRatio * 55 + (1 - missingRatio) * 35 + (1 - unknownRatio) * 10);
}

function computeFreshnessScore(simulation: MealPlanSimulation): number {
  const totalDays = Math.max(1, simulation.dayStates.length);
  const criticalPressure = simulation.criticalIngredients.length * 9;
  const predictionPressure = simulation.predictions.length * 5;
  const lowPressure = simulation.dayStates.reduce((acc, day) => acc + day.summary.lowCount, 0) / totalDays;

  return clamp(100 - criticalPressure - predictionPressure - lowPressure * 6);
}

export function calculateMealPlanScore(
  projection: MealPlanInventoryProjection,
  simulation: MealPlanSimulation,
  mode: OptimizationMode,
): MealPlanOptimizationScore {
  const itemCount = projection.items.length || 1;
  const missingRatio = (projection.summary.missing + projection.summary.partial) / itemCount;
  const costScore = computeCostScore(projection);
  const wasteScore = computeWasteScore(projection, simulation);
  const freshnessScore = computeFreshnessScore(simulation);
  const reuseScore = clamp((simulation.reusedIngredients.length / itemCount) * 100);
  const balanceScore = computeBalanceScore(simulation);
  const missingScore = clamp(100 - missingRatio * 100);

  const weights = MODE_WEIGHTS[mode];
  const total = clamp(
    costScore * weights.cost +
      wasteScore * weights.waste +
      freshnessScore * weights.freshness +
      reuseScore * weights.reuse +
      balanceScore * weights.balance +
      missingScore * weights.missing,
  );

  return {
    cost: costScore,
    waste: wasteScore,
    freshness: freshnessScore,
    reuse: reuseScore,
    balance: balanceScore,
    missing: missingScore,
    total,
  };
}

export function compareMealPlans(
  before: MealPlanOptimizationScore,
  after: MealPlanOptimizationScore,
): MealPlanComparison {
  return {
    before,
    after,
    deltas: {
      cost: after.cost - before.cost,
      reuse: after.reuse - before.reuse,
      missing: after.missing - before.missing,
      freshness: after.freshness - before.freshness,
    },
  };
}

export function explainOptimization(comparison: MealPlanComparison, mode: OptimizationMode): string[] {
  const notes: string[] = [];

  if (comparison.deltas.cost > 0) {
    notes.push('La reorganización reduce presión de compra y mejora el score de costo semanal.');
  }
  if (comparison.deltas.reuse > 0) {
    notes.push('Se incrementó la reutilización de ingredientes entre recetas cercanas.');
  }
  if (comparison.deltas.missing > 0) {
    notes.push('El nuevo orden reduce faltantes operativos en la semana.');
  }
  if (comparison.deltas.freshness > 0) {
    notes.push('Se adelantan recetas sensibles para mejorar frescura y evitar desperdicio.');
  }

  if (notes.length === 0) {
    notes.push('El cambio prioriza estabilidad del menú sin impacto negativo relevante.');
  }

  const modeNote =
    mode === 'optimize_cost'
      ? 'Modo costo: prioriza reducir compras y puede sacrificar algo de variedad.'
      : mode === 'prioritize_fresh'
        ? 'Modo frescura: adelanta ingredientes sensibles para evitar vencimientos.'
        : mode === 'reduce_missing'
          ? 'Modo faltantes: prioriza cobertura operativa para reducir compras urgentes.'
          : 'Modo balanceado: busca equilibrio entre costo, faltantes y frescura.';

  return [...notes.slice(0, 3), modeNote];
}
