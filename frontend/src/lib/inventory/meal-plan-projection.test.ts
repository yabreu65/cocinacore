import { describe, expect, it } from 'vitest';
import {
  buildMealPlanInventoryProjection,
  buildSmartShoppingList,
  consolidateMissingIngredients,
  estimateShoppingCost,
} from './meal-plan-projection';
import type { RecipeRequirement } from './recipe-requirements';

const recipeRequirements: RecipeRequirement[] = [
  {
    ingredientName: 'Tomate',
    normalizedName: 'tomate',
    requiredQuantity: 4,
    requiredUnit: 'unidad',
    usedInRecipes: ['Pasta A'],
  },
  {
    ingredientName: 'Tomate',
    normalizedName: 'tomate',
    requiredQuantity: 2,
    requiredUnit: 'unidad',
    usedInRecipes: ['Ensalada B'],
  },
  {
    ingredientName: 'Arroz',
    normalizedName: 'arroz',
    requiredQuantity: 500,
    requiredUnit: 'g',
    usedInRecipes: ['Bowl C'],
  },
  {
    ingredientName: 'Leche',
    normalizedName: 'leche',
    requiredQuantity: 1,
    requiredUnit: 'l',
    usedInRecipes: ['Sopa D'],
  },
  {
    ingredientName: 'Sal',
    normalizedName: 'sal',
    requiredQuantity: null,
    requiredUnit: 'unknown',
    usedInRecipes: ['Sopa D'],
  },
];

describe('meal-plan-projection', () => {
  it('aggregates repeated ingredients and calculates projection', () => {
    const projection = buildMealPlanInventoryProjection(recipeRequirements, [
      { ingredient_name: 'tomate', quantity: '3', unit: 'unidad', category: 'Verduras', estimated_unit_price: 0.5 },
      { ingredient_name: 'arroz', quantity: '1 kg', unit: null, category: 'Granos', estimated_unit_price: 0.01 },
      { ingredient_name: 'leche', quantity: '500 ml', unit: null, category: 'Lácteos', estimated_unit_price: 1.2 },
    ]);

    const tomato = projection.items.find((item) => item.normalizedName === 'tomate');
    expect(tomato).toBeDefined();
    expect(tomato?.requiredTotalQuantity).toBe(6);
    expect(tomato?.status).toBe('partial');
    expect(tomato?.missingQuantity).toBe(3);

    const rice = projection.items.find((item) => item.normalizedName === 'arroz');
    expect(rice?.status).toBe('sufficient');

    const milk = projection.items.find((item) => item.normalizedName === 'leche');
    expect(milk?.status).toBe('partial');

    const salt = projection.items.find((item) => item.normalizedName === 'sal');
    expect(salt?.status).toBe('unknown');
  });

  it('consolidates missing ingredients from partial/missing/unknown', () => {
    const projection = buildMealPlanInventoryProjection(recipeRequirements, [
      { ingredient_name: 'tomate', quantity: '1', unit: 'unidad', category: 'Verduras', estimated_unit_price: 0.5 },
      { ingredient_name: 'arroz', quantity: '100 g', unit: null, category: 'Granos', estimated_unit_price: 0.01 },
    ]);

    const consolidated = consolidateMissingIngredients(projection.items);
    expect(consolidated.some((item) => item.normalizedName === 'tomate')).toBe(true);
    expect(consolidated.some((item) => item.normalizedName === 'arroz')).toBe(true);
    expect(consolidated.some((item) => item.normalizedName === 'sal')).toBe(true);
  });

  it('builds smart shopping list grouped by category', () => {
    const projection = buildMealPlanInventoryProjection(recipeRequirements, [
      { ingredient_name: 'tomate', quantity: '1', unit: 'unidad', category: 'Verduras', estimated_unit_price: 0.5 },
      { ingredient_name: 'arroz', quantity: '100 g', unit: null, category: 'Granos', estimated_unit_price: 0.01 },
    ]);

    const shopping = buildSmartShoppingList(projection);
    expect(shopping.groups.length).toBeGreaterThan(0);
    expect(shopping.groups.find((group) => group.category === 'Verduras')?.items.length).toBeGreaterThan(0);

    const unknownItem = shopping.groups.flatMap((group) => group.items).find((item) => item.normalizedName === 'sal');
    expect(unknownItem?.status).toBe('review');
  });

  it('estimates shopping cost from missing quantities and unit price', () => {
    const total = estimateShoppingCost([
      { missingQuantity: 3, estimatedUnitPrice: 2, status: 'missing' },
      { missingQuantity: 1.5, estimatedUnitPrice: 4, status: 'partial' },
      { missingQuantity: null, estimatedUnitPrice: 10, status: 'unknown' },
      { missingQuantity: 2, estimatedUnitPrice: null, status: 'missing' },
    ]);
    expect(total).toBe(12);
  });

  it('keeps unknown status for non comparable units', () => {
    const projection = buildMealPlanInventoryProjection(
      [
        {
          ingredientName: 'Leche',
          normalizedName: 'leche',
          requiredQuantity: 1,
          requiredUnit: 'l',
          usedInRecipes: ['A'],
        },
      ],
      [{ ingredient_name: 'Leche', quantity: '1 kg', unit: null, category: 'Lácteos' }],
    );

    expect(projection.items[0].status).toBe('unknown');
  });
});
