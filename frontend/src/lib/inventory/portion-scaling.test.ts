import { describe, expect, it } from 'vitest';
import { scaleRecipeIngredients } from './portion-scaling';

describe('scaleRecipeIngredients', () => {
  it('scales parseable quantities from explicit base to target servings without converting units', () => {
    expect(scaleRecipeIngredients(['1 kg arroz', '1/2 taza aceite'], 4, 2)).toEqual({
      status: 'scaled',
      factor: 0.5,
      ingredients: [
        { source: '1 kg arroz', text: '0.5 kg arroz', scaled: true },
        { source: '1/2 taza aceite', text: '0.25 taza aceite', scaled: true },
      ],
    });
  });

  it('preserves exact scaled quantities rather than rounding or hiding positive amounts', () => {
    expect(scaleRecipeIngredients(['1/3 taza azúcar'], 3, 2).ingredients[0]).toEqual({
      source: '1/3 taza azúcar',
      text: '2/9 taza azúcar',
      scaled: true,
    });
    expect(scaleRecipeIngredients(['1.005 kg harina'], 4, 4).ingredients[0]).toEqual({
      source: '1.005 kg harina',
      text: '1.005 kg harina',
      scaled: true,
    });
    expect(scaleRecipeIngredients(['0.001 kg harina'], 4, 1).ingredients[0]).toEqual({
      source: '0.001 kg harina',
      text: '0.00025 kg harina',
      scaled: true,
    });
  });

  it('preserves free-text and unrecognized units while marking mixed results partial', () => {
    expect(
      scaleRecipeIngredients(['1 kg arroz', 'al gusto', '2 puñados avena', '2 tomates'], 4, 2)
    ).toEqual({
      status: 'partial',
      factor: 0.5,
      ingredients: [
        { source: '1 kg arroz', text: '0.5 kg arroz', scaled: true },
        { source: 'al gusto', text: 'al gusto', scaled: false },
        { source: '2 puñados avena', text: '2 puñados avena', scaled: false },
        { source: '2 tomates', text: '2 tomates', scaled: false },
      ],
    });
  });

  it.each([
    [null, 2],
    [0, 2],
    [-1, 2],
    [NaN, 2],
    [Infinity, 2],
    [Number.MIN_VALUE, 2],
    [4, 1.5],
    [4, null],
    [4, 0],
    [4, 101],
  ] as const)(
    'keeps every source quantity unchanged when servings are absent or invalid (%s, %s)',
    (base, target) => {
      const result = scaleRecipeIngredients(['1 kg arroz'], base, target);
      expect(result.status).toBe('unknown');
      expect(result.factor).toBeNull();
      expect(result.ingredients).toEqual([
        { source: '1 kg arroz', text: '1 kg arroz', scaled: false },
      ]);
    }
  );

  it('accepts positive finite fractional and large original servings', () => {
    expect(scaleRecipeIngredients(['1 kg arroz'], 1.5, 3)).toEqual({
      status: 'scaled',
      factor: 2,
      ingredients: [{ source: '1 kg arroz', text: '2 kg arroz', scaled: true }],
    });
    expect(scaleRecipeIngredients(['1 kg arroz'], 200, 2)).toEqual({
      status: 'scaled',
      factor: 0.01,
      ingredients: [{ source: '1 kg arroz', text: '0.01 kg arroz', scaled: true }],
    });
    expect(scaleRecipeIngredients(['1 kg arroz'], 0.3, 1).ingredients[0].text).toBe(
      '10/3 kg arroz'
    );
  });
  it('reports unknown when no ingredient amount can be scaled', () => {
    expect(scaleRecipeIngredients(['arroz', 'al gusto'], 4, 2)).toMatchObject({
      status: 'unknown',
      factor: 0.5,
      ingredients: [
        { text: 'arroz', scaled: false },
        { text: 'al gusto', scaled: false },
      ],
    });
  });
});
