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
    expect(requirements[0].ingredientName).toBe('arroz');
    expect(requirements[1].ingredientName).toBe('pollo');
    expect(requirements[0].usedInRecipes).toContain('Paella');
  });

  it('strips simple and mixed fraction quantity prefixes', () => {
    const requirements = extractRecipeRequirements({
      ingredients: ['1/2 kg pollo', '1 1/2 kg pollo'],
    });
    expect(requirements).toHaveLength(2);
    expect(requirements[0]).toMatchObject({
      ingredientName: 'pollo',
      requiredQuantity: 0.5,
      requiredUnit: 'kg',
    });
    expect(requirements[1]).toMatchObject({
      ingredientName: 'pollo',
      requiredQuantity: 1.5,
      requiredUnit: 'kg',
    });
  });

  it('preserves countable and unrecognized ingredient names', () => {
    const requirements = extractRecipeRequirements({
      ingredients: ['2 tomates', '500 g de arroz', '2 galletas'],
    });
    expect(requirements[0]).toMatchObject({
      ingredientName: 'tomates',
      normalizedName: 'tomates',
      requiredQuantity: 2,
      requiredUnit: 'unidad',
    });
    expect(requirements[1]).toMatchObject({
      ingredientName: 'arroz',
      requiredQuantity: 500,
      requiredUnit: 'g',
    });
    expect(requirements[2]).toMatchObject({
      ingredientName: 'galletas',
      requiredQuantity: null,
      requiredUnit: 'unknown',
    });
  });

  it('accepts legacy embedded quantities and rejects contradictory columns', () => {
    const requirements = extractRecipeRequirements([
      { name: 'arroz', quantity: '1 kg', unit: null },
      { name: 'harina', quantity: '1 kg', unit: 'g' },
    ]);
    expect(requirements[0]).toMatchObject({ requiredQuantity: 1, requiredUnit: 'kg' });
    expect(requirements[1]).toMatchObject({ requiredQuantity: null, requiredUnit: 'unknown' });
  });
  it('groups exact fractions and keeps unknown quantities unknown', () => {
    const ingredients = [{ name: 'aceite', quantity: '1/3', unit: 'taza' }];
    const grouped = groupRequirementsByIngredient(
      extractRecipeRequirements([...ingredients, ...ingredients, ...ingredients])
    );
    expect(grouped[0]).toMatchObject({ requiredQuantity: 1, requiredUnit: 'taza' });
    expect(
      groupRequirementsByIngredient(
        extractRecipeRequirements([...ingredients, { name: 'aceite', quantity: 'al gusto' }])
      )[0]
    ).toMatchObject({ requiredQuantity: null, requiredUnit: 'unknown' });
    expect(
      extractRecipeRequirements([{ name: 'sal', quantity: '2', unit: null }])[0]
    ).toMatchObject({ requiredQuantity: null, requiredUnit: 'unknown' });
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
    expect(grouped[0].requiredUnit).toBe('g');
  });

  it('converts and aggregates compatible quantities using the coarser unit', () => {
    const grouped = groupRequirementsByIngredient([
      {
        ingredientName: 'arroz',
        normalizedName: 'arroz',
        requiredQuantity: 500,
        requiredUnit: 'g',
        usedInRecipes: [],
      },
      {
        ingredientName: 'Arroz',
        normalizedName: 'arroz',
        requiredQuantity: 1,
        requiredUnit: 'kg',
        usedInRecipes: [],
      },
    ]);
    expect(grouped[0]).toMatchObject({ requiredQuantity: 1.5, requiredUnit: 'kg' });
  });

  it('keeps incompatible mixed-unit quantities unknown', () => {
    const grouped = groupRequirementsByIngredient([
      {
        ingredientName: 'leche',
        normalizedName: 'leche',
        requiredQuantity: 1,
        requiredUnit: 'l',
        usedInRecipes: [],
      },
      {
        ingredientName: 'leche',
        normalizedName: 'leche',
        requiredQuantity: 1,
        requiredUnit: 'kg',
        usedInRecipes: [],
      },
      {
        ingredientName: 'leche',
        normalizedName: 'leche',
        requiredQuantity: 500,
        requiredUnit: 'ml',
        usedInRecipes: [],
      },
    ]);
    expect(grouped[0]).toMatchObject({ requiredQuantity: null, requiredUnit: 'unknown' });
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

  it('sums compatible inventory lots with the same normalized ingredient', () => {
    const result = compareRecipeRequirementsToInventory(
      [
        {
          ingredientName: 'arroz',
          normalizedName: 'arroz',
          requiredQuantity: 2.1,
          requiredUnit: 'kg',
          usedInRecipes: [],
        },
      ],
      [
        { ingredient_name: 'Arroz', quantity: '1.4', unit: 'kg' },
        { ingredient_name: ' arroz ', quantity: '700', unit: 'g' },
      ]
    );
    expect(result[0]).toMatchObject({
      availableQuantity: 2.1,
      missingQuantity: 0,
      status: 'sufficient',
    });
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
    expect(requirements.map((item) => item.ingredientName)).not.toContain('cocinar');
  });

  it('stops markdown ingredient extraction at plain instruction labels', () => {
    const requirements = extractRecipeRequirements({
      markdown: 'Ingredientes\n- 2 tomates\nPreparación:\n- cocinar\n- servir',
    });
    expect(requirements.map((item) => item.ingredientName)).toEqual(['tomates']);
  });
  it.each([
    ['1/3', '1/3', 'taza', 'sufficient', 0],
    ['0.0001', '0.00005', 'kg', 'partial', 0.00005],
    ['1/3', '1/6', 'taza', 'partial', 1 / 6],
  ])('compares exact amount %s against %s %s', (required, available, unit, status, missingQuantity) => {
    const requirements = extractRecipeRequirements([{ name: 'arroz', quantity: required, unit }]);
    expect(compareRecipeRequirementsToInventory(requirements, [
      { ingredient_name: 'arroz', quantity: available, unit },
    ])[0]).toMatchObject({ status, missingQuantity });
  });

  it('does not infer shortages from ambiguous inventory lots', () => {
    const requirements = extractRecipeRequirements([{ name: 'arroz', quantity: '1', unit: 'kg' }]);
    expect(compareRecipeRequirementsToInventory(requirements, [
      { ingredient_name: 'arroz', quantity: '0.5', unit: 'kg' },
      { ingredient_name: 'arroz', quantity: null, unit: 'kg' },
    ])[0]).toMatchObject({ status: 'unknown', missingQuantity: null });
  });

  it('compares a legacy text fraction with exact stock without rounding its basis', () => {
    const requirements = extractRecipeRequirements({ ingredients: ['1/3 taza arroz'] });
    expect(requirements[0].exactQuantityBasis).toEqual({ numerator: '1', denominator: '3' });
    expect(compareRecipeRequirementsToInventory(requirements, [
      { ingredient_name: 'arroz', quantity: '1/3', unit: 'taza' },
    ])[0]).toMatchObject({ status: 'sufficient', missingQuantity: 0 });
  });

  it.each(['1 taza arroz al gusto', '1 taza arroz cantidad necesaria', '1 taza aceite para freír', '2 tomates al gusto', '0 g arroz'])(
    'never upgrades an ambiguous or invalid strict amount through a fallback: %s', (line) => {
      const requirements = extractRecipeRequirements({ ingredients: [line] });
      expect(requirements).toHaveLength(1);
      expect(requirements[0]).toMatchObject({ requiredQuantity: null, requiredUnit: 'unknown' });
      expect(requirements[0].exactQuantityBasis).toBeUndefined();
      expect(compareRecipeRequirementsToInventory(requirements, [])[0]).toMatchObject({ status: 'unknown', missingQuantity: null });
    }
  );

  it('distinguishes an exact non-projectable fraction from a contradictory structured flag', () => {
    const rows = extractRecipeRequirements([
      { name: 'arroz', quantity: 1, unit: 'kg', exact_quantity_text: '1', structured: false },
      { name: 'aceite', quantity: null, unit: 'taza', exact_quantity_text: '1/3', structured: false },
      { name: 'leche', quantity: null, unit: 'taza', exact_quantity_text: '1/3', structured: true },
      { name: 'pollo', quantity: 1, unit: 'kg', exact_quantity_text: '1', structured: true },
    ]);
    expect(rows[0]).toMatchObject({ requiredQuantity: null, requiredUnit: 'unknown' });
    expect(rows[1]).toMatchObject({ requiredQuantity: 1 / 3, requiredUnit: 'taza', exactQuantityBasis: { numerator: '1', denominator: '3' } });
    expect(rows[2]).toMatchObject({ requiredQuantity: null, requiredUnit: 'unknown' });
    expect(rows[3]).toMatchObject({ requiredQuantity: 1, requiredUnit: 'kg' });
  });

  it.each([{ quantity: null, unit: 'kg' }, { quantity: '1', unit: 'taza' }])(
    'keeps sufficient known stock but an unknown remainder when another lot is ambiguous (%j)', (other) => {
      const requirements = extractRecipeRequirements([{ name: 'arroz', quantity: '1', unit: 'kg' }]);
      expect(compareRecipeRequirementsToInventory(requirements, [
        { ingredient_name: 'arroz', quantity: '2', unit: 'kg' },
        { ingredient_name: 'arroz', ...other },
      ])[0]).toMatchObject({ status: 'sufficient', availableQuantity: 2, missingQuantity: 0, remainingQuantity: null });
      expect(compareRecipeRequirementsToInventory(requirements, [
        { ingredient_name: 'arroz', quantity: '2', unit: 'kg' },
      ])[0]).toMatchObject({ status: 'sufficient', remainingQuantity: 1 });
    }
  );

});
