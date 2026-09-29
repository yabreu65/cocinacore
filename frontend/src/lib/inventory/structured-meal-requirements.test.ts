import { describe, expect, it } from 'vitest';
import type { StructuredMealPlan } from '@/lib/meal-planner/structured-plan';
import { structuredMealPlanToRequirements } from './structured-meal-requirements';

function plan(): StructuredMealPlan {
  return {
    period: 'week',
    dayCount: 1,
    days: [
      {
        dayIndex: 1,
        label: 'Lunes',
        meals: [
          {
            mealType: 'breakfast',
            title: 'Avena con fruta',
            description: null,
            ingredients: [
              { name: 'Avena', quantity: 2, unit: 'tazas' },
              { name: 'Fruta', quantity: null, unit: null },
            ],
          },
          {
            mealType: 'lunch',
            title: 'Arroz',
            description: null,
            ingredients: [{ name: 'Arroz', quantity: 1, unit: 'kg' }],
          },
          {
            mealType: 'dinner',
            title: 'Sopa',
            description: null,
            ingredients: [{ name: 'Calabaza', quantity: 3, unit: 'unidades' }],
          },
        ],
      },
    ],
  };
}

describe('structuredMealPlanToRequirements', () => {
  it('converts ingredients with deterministic provenance and keeps nullable quantities and units', () => {
    expect(structuredMealPlanToRequirements(plan())).toEqual([
      expect.objectContaining({
        ingredientName: 'Avena',
        requiredQuantity: 2,
        requiredUnit: 'taza',
        usedInRecipes: ['Lunes · Desayuno · Avena con fruta'],
      }),
      expect.objectContaining({
        ingredientName: 'Fruta',
        requiredQuantity: null,
        requiredUnit: 'unknown',
        usedInRecipes: ['Lunes · Desayuno · Avena con fruta'],
      }),
      expect.objectContaining({
        ingredientName: 'Arroz',
        requiredQuantity: 1,
        requiredUnit: 'kg',
        usedInRecipes: ['Lunes · Almuerzo · Arroz'],
      }),
      expect.objectContaining({
        ingredientName: 'Calabaza',
        requiredQuantity: 3,
        requiredUnit: 'unidad',
        usedInRecipes: ['Lunes · Cena · Sopa'],
      }),
    ]);
  });

  it('keeps canonical ingredient quantities unchanged', () => {
    const requirement = structuredMealPlanToRequirements(plan())[0];
    expect(requirement.requiredQuantity).toBe(2);
  });
});
