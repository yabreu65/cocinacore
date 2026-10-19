import { describe, expect, it } from 'vitest';
import { filterRecipes, scaleIngredients, type Recipe } from './recipe-ui';
import { payloadFromDraft } from './RecipeLibraryClient';

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
  it('filters title, category, and tags', () => {
    expect(filterRecipes([recipe], 'tarta', 'all', 'all')).toHaveLength(1);
    expect(filterRecipes([recipe], '', 'Postre', 'rápido')).toHaveLength(1);
    expect(filterRecipes([recipe], '', 'Plato', 'all')).toHaveLength(0);
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
});
