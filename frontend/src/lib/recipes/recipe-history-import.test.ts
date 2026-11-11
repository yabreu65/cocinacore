import { describe, expect, it } from 'vitest';
import { buildRecipeImportFromHistory } from './recipe-history-import';

const id = 'f1e2d3c4-a5b6-47c8-9012-3456789abcde';

describe('UX3: recover an AI recipe from its history without regenerating', () => {
  it('converts a persisted history payload to the existing import API contract', () => {
    const result = buildRecipeImportFromHistory({
      id,
      title: 'Una receta',
      payload: {
        full_recipe: 'Mezclar y cocinar con precaución.',
        title: 'Pollo al horno',
        peopleCount: 3,
        structuredIngredients: [
          { name: 'Pollo', quantity: 1.2, unit: 'kg' },
          { name: 'Sal', quantity: null, unit: null },
        ],
      },
    });
    expect(result).toEqual({
      title: 'Pollo al horno',
      instructions: 'Mezclar y cocinar con precaución.',
      servings: 3,
      ingredients: [
        { name: 'Pollo', quantity: '1.2', unit: 'kg' },
        { name: 'Sal', quantity: null, unit: null },
      ],
      sourceRecipeHistoryId: id,
    });
  });

  it('preserves an older full text recipe even if structured ingredients are absent', () => {
    expect(
      buildRecipeImportFromHistory({
        id,
        title: 'Sopa',
        payload: { full_recipe: 'Hervir los ingredientes.' },
      })
    ).toMatchObject({ title: 'Sopa', servings: 4, ingredients: [] });
  });

  it('rejects history entries that cannot be safely sent to the creation endpoint', () => {
    expect(
      buildRecipeImportFromHistory({ id: 'invalid', title: 'X', payload: { full_recipe: 'Texto' } })
    ).toBeNull();
    expect(buildRecipeImportFromHistory({ id, title: 'X', payload: { title: 'X' } })).toBeNull();
    expect(
      buildRecipeImportFromHistory({ id, title: null, payload: { full_recipe: 'Texto' } })
    ).toBeNull();
    expect(
      buildRecipeImportFromHistory({ id, title: 'X', payload: { full_recipe: 'a'.repeat(20_001) } })
    ).toBeNull();
  });

  it('ignores malformed ingredient rows instead of sending invalid data to the API', () => {
    const result = buildRecipeImportFromHistory({
      id,
      title: 'Tostadas',
      payload: {
        full_recipe: 'Tostar.',
        structuredIngredients: [
          { name: 'Pan', quantity: Number.POSITIVE_INFINITY, unit: null },
          { name: '', quantity: 0, unit: 'g' },
        ],
      },
    });
    expect(result?.ingredients).toEqual([{ name: 'Pan', quantity: null, unit: null }]);
  });
});
