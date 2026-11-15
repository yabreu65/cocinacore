import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  filterRecipes,
  ingredientSummary,
  scaleIngredients,
  recipePortionCost,
  type Recipe,
} from './recipe-ui';
import RecipeLibraryClient, {
  draftFromRecipe,
  RecipeEditor,
  payloadFromDraft,
} from './RecipeLibraryClient';

const recipe: Recipe = {
  id: 'public-id',
  category: 'Postre',
  tags: ['rápido'],
  archived_at: null,
  created_at: '',
  updated_at: '',
  current_version: {
    id: 'v',
    version_number: 1,
    title: 'Tarta',
    instructions: 'Mezclar',
    servings: 2,
    ingredients: [
      { name: 'harina', quantity: '100', unit: 'g' },
      { name: 'sal', quantity: 'una pizca', unit: '' },
    ],
  },
};

describe('recipe UI helpers', () => {
  it('scales only recognized numeric quantities and reports partial scaling', () => {
    expect(scaleIngredients(recipe.current_version.ingredients, 2, 4)).toEqual({
      ingredients: [
        { name: 'harina', quantity: '200', unit: 'g' },
        recipe.current_version.ingredients[1],
      ],
      partial: true,
    });
  });
  it('does not scale without valid serving counts', () => {
    expect(scaleIngredients(recipe.current_version.ingredients, 0, 4).ingredients[0].quantity).toBe(
      '100'
    );
    expect(
      scaleIngredients(recipe.current_version.ingredients, 2, -1).ingredients[0].quantity
    ).toBe('100');
  });
  it('preserves ingredients without quantities while scaling numeric values', () => {
    const ingredients = [{ name: 'pimienta' }, { name: 'harina', quantity: '100', unit: 'g' }];
    expect(scaleIngredients(ingredients, 2, 4)).toEqual({
      ingredients: [ingredients[0], { name: 'harina', quantity: '200', unit: 'g' }],
      partial: true,
    });
    expect(scaleIngredients(ingredients, 2, 2).partial).toBe(false);
  });
  it('preserves the individual preparation lines and scales exact amounts', () => {
    expect(
      scaleIngredients(
        [
          { name: 'arroz', quantity: '250', unit: 'g' },
          { name: 'Arroz', quantity: '1/2', unit: 'kg' },
          { name: 'sal', quantity: 'al gusto' },
        ],
        2,
        4
      )
    ).toEqual({
      ingredients: [
        { name: 'arroz', quantity: '500', unit: 'g' },
        { name: 'Arroz', quantity: '1', unit: 'kg' },
        { name: 'sal', quantity: 'al gusto' },
      ],
      partial: true,
    });
    expect(
      scaleIngredients([{ name: 'aceite', quantity: '1/3', unit: 'taza' }], 2, 4).ingredients[0]
        ?.quantity
    ).toBe('2/3');
    expect(
      scaleIngredients([{ name: 'harina', quantity: '0.001', unit: 'kg' }], 4, 1).ingredients[0]
        ?.quantity
    ).toBe('0.00025');
  });
  it('scales legacy embedded units, without guessing conflicting units', () => {
    const ingredients = [
      { name: 'arroz', quantity: '1 kg', unit: null },
      { name: 'harina', quantity: '1 kg', unit: 'g' },
    ];
    expect(scaleIngredients(ingredients, 2, 4)).toEqual({
      ingredients: [{ name: 'arroz', quantity: '2', unit: 'kg' }, ingredients[1]],
      partial: true,
    });
  });
  it('preserves ambiguous duplicates and refuses invalid serving counts', () => {
    const ingredients = [
      { name: 'leche', quantity: '1', unit: 'l' },
      { name: 'leche', quantity: '1', unit: 'kg' },
    ];
    expect(scaleIngredients(ingredients, 2, 4).ingredients).toEqual([
      { name: 'leche', quantity: '2', unit: 'l' },
      { name: 'leche', quantity: '2', unit: 'kg' },
    ]);
    expect(scaleIngredients(ingredients, 2, 0)).toEqual({ ingredients, partial: true });
    expect(scaleIngredients(ingredients, 2, 101)).toEqual({ ingredients, partial: true });
  });
  it('uses B1 for scaled costs, with no invented prices or mixed currencies', () => {
    const ingredients = [
      { name: 'arroz', quantity: '250', unit: 'g' },
      { name: 'Arroz', quantity: '1/2', unit: 'kg' },
    ];
    const lots = [
      {
        ingredient_name: 'arroz',
        estimated_unit_price: '4000',
        price_currency: 'COP',
        price_reference_quantity: '1',
        price_reference_unit: 'kg',
      },
    ];
    expect(
      recipePortionCost([{ name: 'arroz', quantity: '1 kg', unit: null }], 2, 4, lots, 'COP')
    ).toMatchObject({ status: 'complete', amount: '8000.00' });
    expect(
      recipePortionCost([{ name: 'arroz', quantity: '1 kg', unit: 'g' }], 2, 4, lots, 'COP')
    ).toMatchObject({ status: 'unknown', amount: null });
    expect(recipePortionCost(ingredients, 2, 4, lots, 'COP')).toMatchObject({
      status: 'complete',
      amount: '6000.00',
      currency: 'COP',
      knownCount: 1,
      totalCount: 1,
    });
    expect(
      recipePortionCost([...ingredients, { name: 'sal', quantity: 'al gusto' }], 2, 4, lots, 'COP')
    ).toMatchObject({ status: 'partial', amount: '6000.00', knownCount: 1, totalCount: 2 });
    expect(recipePortionCost(ingredients, 2, 4, lots, 'USD')).toMatchObject({
      status: 'unknown',
      amount: null,
    });
    expect(recipePortionCost(ingredients, 0, 4, lots, 'COP')).toMatchObject({
      status: 'unknown',
      amount: null,
    });
  });
  it('filters title, category, tags, and ingredient names', () => {
    expect(filterRecipes([recipe], 'tarta', 'all', 'all')).toHaveLength(1);
    expect(filterRecipes([recipe], 'postre', 'all', 'all')).toHaveLength(1);
    expect(filterRecipes([recipe], 'rápido', 'all', 'all')).toHaveLength(1);
    expect(filterRecipes([recipe], 'harina', 'all', 'all')).toHaveLength(1);
    expect(filterRecipes([recipe], '', 'Postre', 'rápido')).toHaveLength(1);
    expect(filterRecipes([recipe], '', 'Plato', 'all')).toHaveLength(0);
    expect(filterRecipes([recipe], '', 'Postre', 'lento')).toHaveLength(0);
  });
  it('handles recipes without a category during search', () => {
    const uncategorized = { ...recipe, category: null };
    expect(filterRecipes([uncategorized], 'sin coincidencia', 'all', 'all')).toHaveLength(0);
  });
  it('summarizes up to three ingredients and provides an empty fallback', () => {
    expect(
      ingredientSummary([
        { name: 'harina', quantity: '100', unit: 'g' },
        { name: 'sal', quantity: null, unit: null },
        { name: 'agua', quantity: '1', unit: 'taza' },
        { name: 'extra', quantity: '1', unit: 'unidad' },
      ])
    ).toBe('100 g harina, sal, 1 taza agua');
    expect(ingredientSummary([])).toBe('Sin ingredientes');
  });
  it('maps recipe values into an editable draft, including empty optional fields', () => {
    expect(
      draftFromRecipe({
        ...recipe,
        category: null,
        current_version: { ...recipe.current_version, servings: null },
      })
    ).toEqual({
      title: 'Tarta',
      category: '',
      tags: 'rápido',
      servings: '',
      instructions: 'Mezclar',
      ingredients: recipe.current_version.ingredients,
    });
  });
  it('covers editor rendering for optional cancel and saving states', () => {
    const markup = renderToStaticMarkup(
      createElement(RecipeEditor, {
        initial: {
          title: 'Tarta',
          category: '',
          tags: '',
          servings: '',
          instructions: '',
          ingredients: [{ name: '', quantity: '', unit: '' }],
        },
        onSave: () => undefined,
        onCancel: () => undefined,
        saving: true,
      })
    );
    expect(markup).toContain('disabled');
    expect(markup).toContain('Cancelar');
    expect(markup).toContain('Nombre del ingrediente 1');
  });
  it('renders the initial library loading state without network access', () => {
    expect(renderToStaticMarkup(createElement(RecipeLibraryClient))).toContain('Cargando recetas');
  });
  it('maps the Pasos y notas editor field directly to instructions', () => {
    const payload = payloadFromDraft({
      title: ' Pan ',
      category: '',
      tags: 'rápida, cena',
      servings: '',
      instructions: 'Hornear\ny servir',
      ingredients: [
        { name: ' harina ', quantity: '2', unit: 'tazas' },
        { name: '', quantity: '', unit: '' },
      ],
    });
    expect(payload).toEqual({
      title: 'Pan',
      category: undefined,
      tags: ['rápida', 'cena'],
      servings: undefined,
      instructions: 'Hornear\ny servir',
      ingredients: [{ name: 'harina', quantity: '2', unit: 'tazas' }],
    });
  });
  it('preserves populated optional draft fields and drops blank ingredient metadata', () => {
    expect(
      payloadFromDraft({
        title: ' Pan ',
        category: ' Postres ',
        tags: ', dulce, ',
        servings: '4',
        instructions: 'Hornear',
        ingredients: [{ name: ' harina ', quantity: '', unit: '' }],
      })
    ).toEqual({
      title: 'Pan',
      category: 'Postres',
      tags: ['dulce'],
      servings: 4,
      instructions: 'Hornear',
      ingredients: [{ name: 'harina', quantity: undefined, unit: undefined }],
    });
  });
});
