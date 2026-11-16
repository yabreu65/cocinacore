import { describe, expect, it } from 'vitest';
import { buildRecipeImportFromHistory, historyImportIngredientLimitExceeded } from './recipe-history-import';

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

  it('rejects malformed ingredient rows instead of sending incomplete data to the API', () => {
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
    expect(result).toBeNull();
  });
  it('preserves legacy text even when row count agrees and rejects contradictory canonical metadata', () => {
    const full = 'Pollo\nINGREDIENTES\n- 2 kg pollo\nPREPARACIÓN\nCocinar.';
    for (const row of [
      { name: 'pollo', quantity: null, unit: 'kg' },
      { name: 'arroz', quantity: 2, unit: 'kg' },
      { name: 'pollo', quantity: 3, unit: 'kg' },
      { name: 'pollo', quantity: 2, unit: 'g' },
    ]) {
      expect(buildRecipeImportFromHistory({ id, title: 'Pollo', payload: {
        full_recipe: full, structuredIngredients: [row],
      } })?.instructions).toBe(full);
    }
    const canonical = 'Pollo\n\nINGREDIENTES\n- 2 kg pollo\n\nPREPARACIÓN\nCocinar.';
    const row = { name: 'pollo', quantity: 2, unit: 'kg' };
    expect(buildRecipeImportFromHistory({ id, title: 'Pollo', payload: {
      full_recipe: canonical, preparation: 'Cocinar.', structuredIngredients: [row],
    } })?.instructions).toBe('Cocinar.');
    expect(buildRecipeImportFromHistory({ id, title: 'Pollo', payload: {
      full_recipe: canonical, preparation: 'Cocinar.', structuredIngredients: [{ ...row, quantity: null }],
    } })?.instructions).toBe(canonical);
    expect(buildRecipeImportFromHistory({ id, title: 'Pollo', payload: {
      full_recipe: canonical, preparation: 'Cocinar.', structuredIngredients: [row, null],
    } })).toBeNull();
  });

  it('preserves the original legacy text without duplicating the ingredient name as a quantity', () => {
    const full = 'Guiso\nINGREDIENTES\n- laurel\n- sal al gusto\nPREPARACIÓN\nCocinar.';
    const result = buildRecipeImportFromHistory({ id, title: 'Guiso', payload: {
      full_recipe: full, structuredIngredients: [
        { name: 'laurel', quantity: null, unit: null, optional_quantity_text: ' Laurel ' },
        { name: 'sal al gusto', quantity: null, unit: null, optional_quantity_text: 'sal al gusto' },
        { name: 'pimienta', quantity: null, unit: null, optional_quantity_text: 'cantidad libre' },
      ],
    } });
    expect(result?.instructions).toBe(full);
    expect(result?.ingredients).toEqual([
      { name: 'laurel', quantity: null, unit: null },
      { name: 'sal al gusto', quantity: null, unit: null },
      { name: 'pimienta', quantity: 'cantidad libre', unit: null },
    ]);
  });

  it('preserves every row at the limit and rejects larger legacy recipes without truncating them', () => {
    const rows = Array.from({ length: 105 }, (_, index) => ({
      name: 'Ingrediente ' + (index + 1), quantity: 1, unit: 'g',
    }));
    const payload = { full_recipe: 'Cocinar todos los ingredientes.', structuredIngredients: rows.slice(0, 100) };
    expect(historyImportIngredientLimitExceeded(payload)).toBe(false);
    const valid = buildRecipeImportFromHistory({ id, title: 'Receta', payload });
    expect(valid?.ingredients).toHaveLength(100);
    expect(valid?.ingredients[99]?.name).toBe('Ingrediente 100');
    for (const count of [101, 105]) {
      const oversized = { ...payload, structuredIngredients: rows.slice(0, count) };
      expect(historyImportIngredientLimitExceeded(oversized)).toBe(true);
      expect(buildRecipeImportFromHistory({ id, title: 'Receta', payload: oversized })).toBeNull();
      expect(oversized.structuredIngredients).toHaveLength(count);
    }
  });

  it.each([
    { name: 'x'.repeat(201), quantity: 1, unit: 'g' },
    { name: 'sal', quantity: 1, unit: 'x'.repeat(51) },
    { name: 'sal', quantity: 1, unit: 7 },
    { name: 'sal', quantity: '1/3', unit: 'g' },
    { name: 'sal', quantity: -1, unit: 'g' },
    { name: 'sal', quantity: null, optional_quantity_text: 'x'.repeat(101) },
    { name: 'sal', quantity: 2, exact_quantity_text: '1/3' },
    { name: 'sal', quantity: null, exact_quantity_text: null },
    { name: 'sal', quantity: 1, optional_quantity_text: 'al gusto' },
    null,
  ])('rejects unrepresentable rows without dropping or truncating data: %j', (bad) => {
    const original = { full_recipe: 'Cocinar.', structuredIngredients: [
      { name: 'arroz', quantity: 1, unit: 'g' }, bad,
    ] };
    const snapshot = JSON.stringify(original);
    expect(buildRecipeImportFromHistory({ id, title: 'Guiso', payload: original })).toBeNull();
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it('retains exact field limits and exact fractional quantities', () => {
    const name = 'x'.repeat(200);
    const unit = 'u'.repeat(50);
    const note = 'n'.repeat(100);
    const result = buildRecipeImportFromHistory({ id, title: 'Guiso', payload: {
      full_recipe: 'Cocinar.', structuredIngredients: [
        { name, quantity: null, exact_quantity_text: '1/3', unit },
        { name: 'sal', quantity: null, optional_quantity_text: note },
      ],
    } });
    expect(result?.ingredients).toEqual([
      { name, quantity: '1/3', unit },
      { name: 'sal', quantity: note, unit: null },
    ]);
  });

  it.each([0, 101, '4', 1.5])('rejects an explicit invalid serving count: %s', (peopleCount) => {
    expect(buildRecipeImportFromHistory({ id, title: 'Guiso', payload: { full_recipe: 'Cocinar.', peopleCount } })).toBeNull();
  });

  it('rejects malformed structured metadata instead of treating it as absent', () => {
    expect(buildRecipeImportFromHistory({ id, title: 'Guiso', payload: { full_recipe: 'Cocinar.', structuredIngredients: {} } })).toBeNull();
  });

});
