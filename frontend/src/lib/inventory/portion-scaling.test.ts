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

  it('rounds displayed scaled quantities to two decimals without rounding a positive amount to zero', () => {
    expect(scaleRecipeIngredients(['1/3 taza azúcar'], 3, 2).ingredients[0]).toEqual({
      source: '1/3 taza azúcar',
      text: '0.22 taza azúcar',
      scaled: true,
    });
    expect(scaleRecipeIngredients(['1.005 kg harina'], 4, 4).ingredients[0]).toEqual({
      source: '1.005 kg harina',
      text: '1.01 kg harina',
      scaled: true,
    });
    expect(scaleRecipeIngredients(['0.001 kg harina'], 4, 1).ingredients[0]).toEqual({
      source: '0.001 kg harina',
      text: '0.001 kg harina',
      scaled: false,
    });
  });

  it('preserves free-text and unrecognized units while marking mixed results partial', () => {
    expect(scaleRecipeIngredients(['1 kg arroz', 'al gusto', '2 puñados avena'], 4, 2)).toEqual({
      status: 'partial',
      factor: 0.5,
      ingredients: [
        { source: '1 kg arroz', text: '0.5 kg arroz', scaled: true },
        { source: 'al gusto', text: 'al gusto', scaled: false },
        { source: '2 puñados avena', text: '2 puñados avena', scaled: false },
      ],
    });
  });

  it.each([
    [null, 2],
    [0, 2],
    [-1, 2],
    [4, null],
    [4, 0],
    [4, 101],
  ] as const)('keeps every source quantity unchanged when servings are absent or invalid (%s, %s)', (base, target) => {
    const result = scaleRecipeIngredients(['1 kg arroz'], base, target);
    expect(result.status).toBe('unknown');
    expect(result.factor).toBeNull();
    expect(result.ingredients).toEqual([{ source: '1 kg arroz', text: '1 kg arroz', scaled: false }]);
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
