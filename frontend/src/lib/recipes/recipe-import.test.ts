import { describe, expect, it } from 'vitest';
import type { StructuredRecipeIngredient } from '@/components/recipe-view/types';
import { buildRecipeImportPayload, recipePreparationForImport, renderRecipeDisplay } from './recipe-import';

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
  it('uses explicit canonical preparation only when all display data match', () => {
    const preparation = '1. Cocinar.\n\nTIPS\n- Servir caliente.';
    const rows = [{ name: 'tomate', quantity: '2', unit: 'unidad' }];
    const full = renderRecipeDisplay('Sopa', rows, preparation);
    const imported = buildRecipeImportPayload({
      title: 'Sopa', instructions: full, preparation, servings: 2,
      structuredIngredients: [ingredient()], recipeHistoryId: 'history-4',
    });
    expect(imported.instructions).toBe(preparation);
    expect(imported.ingredients).toEqual(rows);
    expect(recipePreparationForImport(full, 'Sopa', rows, undefined)).toBe(full);
    expect(recipePreparationForImport(full, 'Sopa', [], preparation)).toBe(full);
    for (const mismatched of [
      [{ ...rows[0], name: 'pollo' }],
      [{ ...rows[0], quantity: null }],
      [{ ...rows[0], quantity: '3' }],
      [{ ...rows[0], unit: 'kg' }],
    ]) {
      expect(recipePreparationForImport(full, 'Sopa', mismatched, preparation)).toBe(full);
    }
    expect(recipePreparationForImport(full, 'Sopa', rows, 'Otro paso.')).toBe(full);
  });

  it('preserves qualitative quantities without making them numeric evidence', () => {
    const result = buildRecipeImportPayload({
      title: 'Sopa', instructions: 'Sazonar.', servings: 2, recipeHistoryId: 'history-5',
      structuredIngredients: [ingredient({ name: 'sal', quantity: null, unit: null, optional_quantity_text: 'al gusto', structured: false })],
    });
    expect(result.ingredients[0].quantity).toBe('al gusto');
  });

  it('does not copy a legacy ingredient label into the quantity field', () => {
    const payload = buildRecipeImportPayload({
      title: 'Guiso', instructions: 'Añadir laurel.', servings: 2, recipeHistoryId: 'history-6',
      structuredIngredients: [ingredient({ name: 'Laurel', quantity: null, unit: null, optional_quantity_text: 'laurel', structured: false })],
    });
    expect(payload.ingredients).toEqual([{ name: 'Laurel', quantity: null, unit: null }]);
    expect(payload.instructions).toBe('Añadir laurel.');
  });

});
