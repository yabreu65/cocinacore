import { describe, expect, it } from 'vitest';
import type { StructuredRecipeIngredient } from '@/components/recipe-view/types';
import { buildRecipeImportPayload } from './recipe-import';

function ingredient(overrides: Partial<StructuredRecipeIngredient> = {}): StructuredRecipeIngredient {
  return {
    name: 'tomate',
    normalized_name: 'tomate',
    quantity: 2,
    unit: 'unidad',
    optional_quantity_text: null,
    category: 'Verduras',
    estimated_cost_optional: 12,
    structured: true,
    ...overrides,
  };
}

describe('buildRecipeImportPayload', () => {
  it('maps structured ingredients into the persistent manual ingredient shape', () => {
    expect(buildRecipeImportPayload({
      title: 'Sopa',
      instructions: 'Preparar la sopa.',
      servings: 3,
      structuredIngredients: [ingredient()],
      recipeHistoryId: 'history-1',
    })).toEqual({
      title: 'Sopa',
      instructions: 'Preparar la sopa.',
      servings: 3,
      ingredients: [{ name: 'tomate', quantity: '2', unit: 'unidad' }],
      sourceRecipeHistoryId: 'history-1',
    });
  });

  it('preserves null quantities and units', () => {
    const payload = buildRecipeImportPayload({
      title: 'Sopa',
      instructions: 'Preparar la sopa.',
      servings: 4,
      structuredIngredients: [ingredient({ quantity: null, unit: null })],
      recipeHistoryId: 'history-2',
    });

    expect(payload.ingredients).toEqual([{ name: 'tomate', quantity: null, unit: null }]);
  });

  it('links the history and excludes ownership and arbitrary structured metadata', () => {
    const payload = buildRecipeImportPayload({
      title: 'Sopa',
      instructions: 'Preparar la sopa.',
      servings: 2,
      structuredIngredients: [ingredient()],
      recipeHistoryId: 'history-3',
    });

    expect(payload.sourceRecipeHistoryId).toBe('history-3');
    expect(payload).not.toHaveProperty('tenantId');
    expect(payload).not.toHaveProperty('userId');
    expect(payload.ingredients[0]).not.toHaveProperty('normalized_name');
    expect(payload.ingredients[0]).not.toHaveProperty('category');
    expect(payload.ingredients[0]).not.toHaveProperty('estimated_cost_optional');
    expect(payload.ingredients[0]).not.toHaveProperty('structured');
  });
});
