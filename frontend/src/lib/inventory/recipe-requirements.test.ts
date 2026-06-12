import { describe, expect, it } from 'vitest';
import {
  compareRecipeRequirementsToInventory,
  extractRecipeRequirements,
  groupRequirementsByIngredient,
} from './recipe-requirements';

describe('recipe-requirements', () => {
  it('extracts requirements from simple payload', () => {
    const requirements = extractRecipeRequirements({
      title: 'Paella',
      ingredients: ['500 g arroz', '1 kg pollo'],
    });
    expect(requirements).toHaveLength(2);
    expect(requirements[0].usedInRecipes).toContain('Paella');
  });

  it('groups duplicated ingredients', () => {
    const grouped = groupRequirementsByIngredient([
      {
        ingredientName: 'arroz',
        normalizedName: 'arroz',
        requiredQuantity: 200,
        requiredUnit: 'g',
        usedInRecipes: [],
      },
      {
        ingredientName: 'Arroz',
        normalizedName: 'arroz',
        requiredQuantity: 300,
        requiredUnit: 'g',
        usedInRecipes: [],
      },
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].requiredQuantity).toBe(500);
  });

  it('compares sufficient inventory', () => {
    const result = compareRecipeRequirementsToInventory(
      [
        {
          ingredientName: 'arroz',
          normalizedName: 'arroz',
          requiredQuantity: 300,
          requiredUnit: 'g',
          usedInRecipes: [],
        },
      ],
      [{ ingredient_name: 'Arroz', quantity: '1 kg', unit: null }]
    );
    expect(result[0].status).toBe('sufficient');
  });

  it('compares partial inventory', () => {
    const result = compareRecipeRequirementsToInventory(
      [
        {
          ingredientName: 'arroz',
          normalizedName: 'arroz',
          requiredQuantity: 500,
          requiredUnit: 'g',
          usedInRecipes: [],
        },
      ],
      [{ ingredient_name: 'Arroz', quantity: '250 g', unit: null }]
    );
    expect(result[0].status).toBe('partial');
  });

  it('detects missing ingredient', () => {
    const result = compareRecipeRequirementsToInventory(
      [
        {
          ingredientName: 'pollo',
          normalizedName: 'pollo',
          requiredQuantity: 1,
          requiredUnit: 'kg',
          usedInRecipes: [],
        },
      ],
      [{ ingredient_name: 'Arroz', quantity: '1 kg', unit: null }]
    );
    expect(result[0].status).toBe('missing');
  });

  it('marks non comparable units as unknown', () => {
    const result = compareRecipeRequirementsToInventory(
      [
        {
          ingredientName: 'leche',
          normalizedName: 'leche',
          requiredQuantity: 1,
          requiredUnit: 'l',
          usedInRecipes: [],
        },
      ],
      [{ ingredient_name: 'leche', quantity: '1 kg', unit: null }]
    );
    expect(result[0].status).toBe('unknown');
  });

  it('extracts from flexible payload object entries', () => {
    const requirements = extractRecipeRequirements({
      recipe: {
        ingredients: [{ name: 'tomate', quantity: 3, unit: 'unidades' }],
      },
    });
    expect(requirements).toHaveLength(1);
    expect(requirements[0].normalizedName).toBe('tomate');
  });

  it('prioritizes structured ingredients over markdown fallback', () => {
    const requirements = extractRecipeRequirements({
      structured_ingredients: [{ name: 'tomate', quantity: 4, unit: 'unidad' }],
      markdown: 'Ingredientes\n- 1 tomate\nPreparación\n- mezclar',
    });
    expect(requirements).toHaveLength(1);
    expect(requirements[0].requiredQuantity).toBe(4);
    expect(requirements[0].requiredUnit).toBe('unidad');
  });

  it('keeps markdown fallback for legacy payloads without structured ingredients', () => {
    const requirements = extractRecipeRequirements({
      title: 'Receta legacy',
      markdown: 'Ingredientes\n- 500 g arroz\n- sal al gusto\nPreparación\n- cocinar',
    });
    expect(requirements.length).toBeGreaterThan(0);
    const hasStructuredRice = requirements.some(
      (item) => item.requiredQuantity === 500 && item.requiredUnit === 'g'
    );
    const hasUnknownSalt = requirements.some(
      (item) => item.requiredQuantity === null && item.requiredUnit === 'unknown'
    );
    expect(hasStructuredRice).toBe(true);
    expect(hasUnknownSalt).toBe(true);
  });
});
