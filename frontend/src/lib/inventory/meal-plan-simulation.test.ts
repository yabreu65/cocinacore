import { describe, expect, it } from 'vitest';
import { buildMealPlanSimulation } from './meal-plan-simulation';
import type { MealPlanProjectionItem } from './meal-plan-projection';

const projectionItems: MealPlanProjectionItem[] = [
  {
    ingredientName: 'tomate',
    normalizedName: 'tomate',
    requiredTotalQuantity: 4,
    requiredUnit: 'unidad',
    availableQuantity: 6,
    availableUnit: 'unidad',
    projectedUsedQuantity: 4,
    projectedRemainingQuantity: 2,
    missingQuantity: 0,
    status: 'sufficient',
    usedInRecipes: ['Pasta de Lunes', 'Ensalada de Martes'],
    category: 'Verduras',
    estimatedUnitPrice: 0.5,
  },
  {
    ingredientName: 'pollo',
    normalizedName: 'pollo',
    requiredTotalQuantity: 3,
    requiredUnit: 'kg',
    availableQuantity: 1,
    availableUnit: 'kg',
    projectedUsedQuantity: 1,
    projectedRemainingQuantity: 0,
    missingQuantity: 2,
    status: 'missing',
    usedInRecipes: ['Pollo de Miércoles'],
    category: 'Proteínas',
    estimatedUnitPrice: 4,
  },
];

describe('meal-plan-simulation', () => {
  it('builds day playback and predictions', () => {
    const simulation = buildMealPlanSimulation(
      [
        { day: 'Lunes', meals: [{ label: 'Desayuno', title: 'Pasta de Lunes' }] },
        { day: 'Martes', meals: [{ label: 'Cena', title: 'Ensalada de Martes' }] },
        { day: 'Miércoles', meals: [{ label: 'Almuerzo', title: 'Pollo de Miércoles' }] },
      ],
      projectionItems
    );

    expect(simulation.dayStates).toHaveLength(3);
    expect(simulation.weeklyCoverage).toBeGreaterThanOrEqual(0);
    expect(simulation.predictions.length).toBeGreaterThanOrEqual(1);
  });

  it('returns safe empty simulation', () => {
    const simulation = buildMealPlanSimulation([], []);
    expect(simulation.dayStates).toHaveLength(0);
    expect(simulation.weeklyCoverage).toBe(0);
  });
});
