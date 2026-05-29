import { describe, expect, it } from 'vitest';
import {
  buildMealPlanInventoryProjection,
  buildQuantifiedShoppingList,
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
  it('handles weekly family menu with repeated ingredients and merges correctly', () => {
    const shopping = buildQuantifiedShoppingList(
      [
        {
          ingredientName: 'Tomate',
          normalizedName: 'tomate',
          requiredQuantity: 8,
          requiredUnit: 'unidad',
          usedInRecipes: ['Lunes · Almuerzo · Pasta'],
        },
        {
          ingredientName: 'Tomate',
          normalizedName: 'tomate',
          requiredQuantity: 6,
          requiredUnit: 'unidad',
          usedInRecipes: ['Martes · Cena · Ensalada'],
        },
        {
          ingredientName: 'Pollo',
          normalizedName: 'pollo',
          requiredQuantity: 1.2,
          requiredUnit: 'kg',
          usedInRecipes: ['Miércoles · Almuerzo · Pollo al horno'],
        },
        {
          ingredientName: 'Pollo',
          normalizedName: 'pollo',
          requiredQuantity: 0.3,
          requiredUnit: 'kg',
          usedInRecipes: ['Jueves · Cena · Salteado'],
        },
      ],
      [
        { ingredient_name: 'tomate', quantity: '3', unit: 'unidad', category: 'Verduras', estimated_unit_price: 0.5 },
        { ingredient_name: 'pollo', quantity: '1 kg', unit: null, category: 'Proteínas', estimated_unit_price: 6 },
      ],
    );

    const items = shopping.groups.flatMap((group) => group.items);
    const tomato = items.find((item) => item.normalizedName === 'tomate');
    const chicken = items.find((item) => item.normalizedName === 'pollo');

    expect(tomato?.requiredQuantity).toBe(14);
    expect(tomato?.availableQuantity).toBe(3);
    expect(tomato?.quantityToBuy).toBe(11);
    expect(tomato?.usedInRecipes.length).toBe(2);

    expect(chicken?.requiredQuantity).toBe(1.5);
    expect(chicken?.availableQuantity).toBe(1);
    expect(chicken?.quantityToBuy).toBe(0.5);
    expect(chicken?.status).toBe('buy');
  });

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

  it('marks all as buy when inventory is empty', () => {
    const shopping = buildQuantifiedShoppingList(
      [
        {
          ingredientName: 'Arroz',
          normalizedName: 'arroz',
          requiredQuantity: 500,
          requiredUnit: 'g',
          usedInRecipes: ['A'],
        },
        {
          ingredientName: 'Tomate',
          normalizedName: 'tomate',
          requiredQuantity: 4,
          requiredUnit: 'unidad',
          usedInRecipes: ['B'],
        },
      ],
      [],
    );

    const statuses = shopping.groups.flatMap((group) => group.items).map((item) => item.status);
    expect(statuses.every((status) => status === 'buy')).toBe(true);
  });

  it('builds quantified list with partial inventory (3 available / 20 required / 17 buy)', () => {
    const shopping = buildQuantifiedShoppingList(
      [
        {
          ingredientName: 'Tomate',
          normalizedName: 'tomate',
          requiredQuantity: 20,
          requiredUnit: 'unidad',
          usedInRecipes: ['Amatriciana', 'Caprese'],
        },
      ],
      [{ ingredient_name: 'Tomate', quantity: '3', unit: 'unidad', category: 'Verduras', estimated_unit_price: 0.5 }],
    );

    const tomato = shopping.groups.flatMap((group) => group.items).find((item) => item.normalizedName === 'tomate');
    expect(tomato).toBeDefined();
    expect(tomato?.requiredQuantity).toBe(20);
    expect(tomato?.availableQuantity).toBe(3);
    expect(tomato?.quantityToBuy).toBe(17);
    expect(tomato?.status).toBe('buy');
  });

  it('supports kg/g and l/ml conversions in quantified shopping', () => {
    const shopping = buildQuantifiedShoppingList(
      [
        {
          ingredientName: 'Arroz',
          normalizedName: 'arroz',
          requiredQuantity: 1200,
          requiredUnit: 'g',
          usedInRecipes: ['Bowl'],
        },
        {
          ingredientName: 'Leche',
          normalizedName: 'leche',
          requiredQuantity: 2,
          requiredUnit: 'l',
          usedInRecipes: ['Sopa'],
        },
      ],
      [
        { ingredient_name: 'Arroz', quantity: '1 kg', unit: null, category: 'Granos' },
        { ingredient_name: 'Leche', quantity: '500 ml', unit: null, category: 'Lácteos' },
      ],
    );
    const items = shopping.groups.flatMap((group) => group.items);
    expect(items.find((item) => item.normalizedName === 'arroz')?.quantityToBuy).toBe(200);
    expect(items.find((item) => item.normalizedName === 'leche')?.quantityToBuy).toBe(1.5);
  });

  it('marks unknown structured quantities as review', () => {
    const shopping = buildQuantifiedShoppingList(
      [
        {
          ingredientName: 'Sal',
          normalizedName: 'sal',
          requiredQuantity: null,
          requiredUnit: 'unknown',
          usedInRecipes: ['Sopa'],
        },
      ],
      [],
    );
    const sal = shopping.groups.flatMap((group) => group.items).find((item) => item.normalizedName === 'sal');
    expect(sal?.status).toBe('review');
  });
});
