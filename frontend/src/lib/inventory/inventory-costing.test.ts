import { describe, expect, it } from 'vitest';
import {
  calculateInventoryCost,
  readInventoryPrice,
  roundInventoryCost,
  type InventoryPriceReference,
} from './inventory-price';
import type { InventoryUnit } from './inventory-input';
import {
  costRecipePortions,
  costRequirements,
  selectIngredientPrice,
  summarizeCosts,
} from './inventory-costing';

const copKg: InventoryPriceReference = {
  amount: '4000',
  currency: 'COP',
  referenceQuantity: '1',
  referenceUnit: 'kg',
};
const lot = (price: InventoryPriceReference | null, name = 'Arroz') => ({
  ingredient_name: name,
  estimated_unit_price: price?.amount ?? null,
  price_currency: price?.currency ?? null,
  price_reference_quantity: price?.referenceQuantity ?? null,
  price_reference_unit: price?.referenceUnit ?? null,
});

describe('inventory costing', () => {
  it('calculates exact requirements and portions from explicit units and servings', () => {
    const fiveHundred = calculateInventoryCost({ quantity: '500', unit: 'g', price: copKg });
    expect(
      fiveHundred.status === 'known' && fiveHundred.cost.numerator / fiveHundred.cost.denominator
    ).toBe(BigInt(2000));
    expect(
      costRecipePortions({
        requirements: [{ ingredientName: 'arroz', quantity: '500', unit: 'g' }],
        recipeServings: '2',
        requestedServings: '4',
        lots: [lot(copKg)],
        currency: 'COP',
      })
    ).toMatchObject({ status: 'complete', amount: '4000.00', knownCount: 1, totalCount: 1 });
    const shortage = calculateInventoryCost({ quantity: '250', unit: 'g', price: copKg });
    expect(shortage.status === 'known' ? roundInventoryCost(shortage.cost) : null).toBe('1000.00');
  });

  it.each([
    ['1/2', '2000.00', '1000.00'],
    ['1 1/2', '6000.00', '3000.00'],
    ['1/3', '1333.33', '666.67'],
  ])(
    'calculates the exact recipe fraction %s without imposing stock storage precision',
    (quantity, total, half) => {
      const requirements = [{ ingredientName: 'arroz', quantity, unit: 'kg' }];
      expect(costRequirements(requirements, [lot(copKg)], 'COP')).toMatchObject({
        status: 'complete',
        amount: total,
      });
      expect(
        costRecipePortions({
          requirements,
          recipeServings: 2,
          requestedServings: 1,
          lots: [lot(copKg)],
          currency: 'COP',
        })
      ).toMatchObject({ status: 'complete', amount: half });
    }
  );
  it.each(['1/0', '-1/2', '1 kg', 'constructor', ''])(
    'rejects invalid recipe amount %s',
    (quantity) => {
      expect(
        costRequirements([{ ingredientName: 'arroz', quantity, unit: 'kg' }], [lot(copKg)], 'COP')
      ).toMatchObject({ status: 'unknown', amount: null });
    }
  );
  it('keeps legitimate zero prices known and rounds only the final amount', () => {
    const zero = { ...copKg, amount: '0' };
    expect(
      costRequirements([{ ingredientName: 'arroz', quantity: '1', unit: 'kg' }], [lot(zero)], 'COP')
    ).toMatchObject({ status: 'complete', amount: '0.00' });
    expect(
      costRequirements(
        [
          { ingredientName: 'a', quantity: '1', unit: 'unidad' },
          { ingredientName: 'b', quantity: '1', unit: 'unidad' },
        ],
        [
          lot(
            { amount: '0.005', currency: 'USD', referenceQuantity: '1', referenceUnit: 'unidad' },
            'a'
          ),
          lot(
            { amount: '0.005', currency: 'USD', referenceQuantity: '1', referenceUnit: 'unidad' },
            'b'
          ),
        ],
        'USD'
      )
    ).toMatchObject({ amount: '0.01', status: 'complete' });
  });

  it('reports coverage without currency mixing or unknown-as-zero behavior', () => {
    expect(
      costRequirements(
        [
          { ingredientName: 'a', quantity: '1', unit: 'unidad' },
          { ingredientName: 'b', quantity: '1', unit: 'unidad' },
        ],
        [
          lot(
            { amount: '2', currency: 'USD', referenceQuantity: '1', referenceUnit: 'unidad' },
            'a'
          ),
          lot(
            { amount: '3', currency: 'EUR', referenceQuantity: '1', referenceUnit: 'unidad' },
            'b'
          ),
        ],
        'USD'
      )
    ).toMatchObject({
      status: 'partial',
      amount: '2.00',
      knownCount: 1,
      totalCount: 2,
      currency: 'USD',
    });
    expect(
      costRequirements([{ ingredientName: 'missing', quantity: '1', unit: 'g' }], [], 'COP')
    ).toMatchObject({ status: 'unknown', amount: null, knownCount: 0, totalCount: 1 });
    expect(costRequirements([], [], 'COP')).toMatchObject({
      status: 'complete',
      amount: '0.00',
      totalCount: 0,
    });
    expect(costRequirements([], [], null)).toMatchObject({
      status: 'complete',
      amount: null,
      currency: null,
    });
  });

  it('rejects conflicting, incomplete, unstructured-unit, and unsupported package evidence', () => {
    const differing = { ...copKg, amount: '5000' };
    expect(selectIngredientPrice('arroz', [lot(copKg), lot(differing)])).toEqual({
      status: 'unknown',
    });
    expect(selectIngredientPrice('arroz', [lot(copKg), lot(null)])).toEqual({ status: 'unknown' });
    expect(
      costRequirements(
        [{ ingredientName: 'arroz', quantity: '2', unit: 'taza' }],
        [lot(copKg)],
        'COP'
      )
    ).toMatchObject({ status: 'unknown', amount: null });
    expect(
      costRequirements(
        [{ ingredientName: 'arroz', quantity: '1', unit: 'paquete' }],
        [lot(copKg)],
        'COP'
      )
    ).toMatchObject({ status: 'unknown' });
  });

  it('accepts equivalent kg/g reference rates and keeps large totals exact', () => {
    const perGram = { ...copKg, amount: '4', referenceUnit: 'g' as const, referenceQuantity: '1' };
    expect(selectIngredientPrice('arroz', [lot(copKg), lot(perGram)])).toMatchObject({
      status: 'known',
    });
    expect(
      costRequirements(
        [{ ingredientName: 'arroz', quantity: '99999999', unit: 'kg' }],
        [lot(copKg)],
        'COP'
      ).amount
    ).toBe('399999996000.00');
  });

  it('accepts multiple equivalent price references across mass and volume bases', () => {
    const perGram = { ...copKg, amount: '4', referenceUnit: 'g' as const, referenceQuantity: '1' };
    const perLiter: InventoryPriceReference = {
      amount: '2',
      currency: 'COP',
      referenceQuantity: '1',
      referenceUnit: 'l',
    };
    const perMilliliter = { ...perLiter, amount: '0.002', referenceUnit: 'ml' as const };

    expect(selectIngredientPrice('arroz', [lot(copKg), lot(perGram)])).toMatchObject({
      status: 'known',
    });
    expect(
      selectIngredientPrice('leche', [lot(perLiter, 'leche'), lot(perMilliliter, 'leche')])
    ).toMatchObject({ status: 'known' });
  });

  it('treats an omitted stored amount as missing or invalid metadata, never as a price', () => {
    expect(readInventoryPrice({})).toMatchObject({ status: 'missing', price: null });
    expect(
      readInventoryPrice({
        price_currency: 'COP',
        price_reference_quantity: '1',
        price_reference_unit: 'kg',
      })
    ).toMatchObject({ status: 'invalid', price: null });
  });

  it('compares reference rates only within exact units or the approved conversion pairs', () => {
    const units: readonly InventoryUnit[] = [
      'g',
      'kg',
      'ml',
      'l',
      'unidad',
      'paquete',
      'taza',
      'cucharada',
      'cucharadita',
    ];
    const compatible = (a: InventoryUnit, b: InventoryUnit) =>
      a === b ||
      (['g', 'kg'].includes(a) && ['g', 'kg'].includes(b)) ||
      (['ml', 'l'].includes(a) && ['ml', 'l'].includes(b)) ||
      (['cucharada', 'cucharadita'].includes(a) && ['cucharada', 'cucharadita'].includes(b));

    for (const a of units) {
      for (const b of units) {
        if (compatible(a, b)) continue;
        const first: InventoryPriceReference = {
          amount: '1',
          currency: 'COP',
          referenceQuantity: '1',
          referenceUnit: a,
        };
        const second: InventoryPriceReference = {
          ...first,
          referenceUnit: b,
        };
        expect(
          selectIngredientPrice('ingredient', [lot(first, 'ingredient'), lot(second, 'ingredient')])
        ).toEqual({ status: 'unknown' });
      }
    }
  });

  it('scales exact recipe costs by fractional serving ratios without truncating quantities', () => {
    const perKg: InventoryPriceReference = {
      amount: '4000',
      currency: 'COP',
      referenceQuantity: '1',
      referenceUnit: 'kg',
    };
    const portions = (recipeServings: string, requestedServings: string, quantity = '1') =>
      costRecipePortions({
        requirements: [{ ingredientName: 'arroz', quantity, unit: 'kg' }],
        recipeServings,
        requestedServings,
        lots: [lot(perKg)],
        currency: 'COP',
      });

    expect(portions('3', '1')).toMatchObject({ status: 'complete', amount: '1333.33' });
    expect(portions('0.5', '1')).toMatchObject({ status: 'complete', amount: '8000.00' });
    expect(portions('2', '0.5')).toMatchObject({ status: 'complete', amount: '1000.00' });
    expect(portions('2', '0')).toMatchObject({
      status: 'unknown',
      amount: null,
      knownCount: 0,
      totalCount: 1,
    });
    expect(portions('2', '-1')).toMatchObject({ status: 'unknown', amount: null });
    expect(portions('0', '1')).toMatchObject({ status: 'unknown', amount: null });
    expect(portions('1', '99999999')).toMatchObject({
      status: 'complete',
      amount: '399999996000.00',
    });
    expect(portions('1', '1', '99999999')).toMatchObject({
      status: 'complete',
      amount: '399999996000.00',
    });
  });

  it('reports only selected-currency known costs and keeps empty coverage explicit', () => {
    const known = (amount: bigint, currency: 'USD' | 'EUR' = 'USD') => ({
      status: 'known' as const,
      cost: { currency, numerator: amount, denominator: BigInt(1) },
    });
    expect(costRequirements([], [], null)).toMatchObject({
      status: 'complete',
      currency: null,
      amount: null,
      knownCount: 0,
      totalCount: 0,
    });
    expect(costRequirements([], [], 'USD')).toMatchObject({
      status: 'complete',
      currency: 'USD',
      amount: '0.00',
      knownCount: 0,
    });
    expect(
      costRequirements(
        [{ ingredientName: 'a', quantity: '1', unit: 'unidad' }],
        [
          lot(
            { amount: '1', currency: 'EUR', referenceQuantity: '1', referenceUnit: 'unidad' },
            'a'
          ),
        ],
        'USD'
      )
    ).toMatchObject({ status: 'unknown', amount: null, knownCount: 0 });
    expect(
      costRequirements(
        [
          { ingredientName: 'a', quantity: '1', unit: 'unidad' },
          { ingredientName: 'missing', quantity: '1', unit: 'unidad' },
        ],
        [
          lot(
            { amount: '2', currency: 'USD', referenceQuantity: '1', referenceUnit: 'unidad' },
            'a'
          ),
        ],
        'USD'
      )
    ).toMatchObject({ status: 'partial', amount: '2.00', knownCount: 1, totalCount: 2 });
    expect(
      costRequirements(
        [{ ingredientName: 'a', quantity: '1', unit: 'unidad' }],
        [
          lot(
            { amount: '2', currency: 'USD', referenceQuantity: '1', referenceUnit: 'unidad' },
            'a'
          ),
        ],
        null
      )
    ).toMatchObject({ status: 'unknown', amount: null, knownCount: 0 });
    expect(summarizeCosts([known(BigInt(2)), known(BigInt(3), 'EUR')], 'USD')).toMatchObject({
      status: 'partial',
      amount: '2.00',
      currency: 'USD',
      knownCount: 1,
      totalCount: 2,
    });
    expect(summarizeCosts([known(BigInt(2))], null)).toMatchObject({
      status: 'unknown',
      amount: null,
      currency: null,
      knownCount: 0,
    });
  });
  it('uses the same 3:1 spoon conversion in costs and lot reference rates', () => {
    const tablespoon: InventoryPriceReference = {
      amount: '300',
      currency: 'COP',
      referenceQuantity: '1',
      referenceUnit: 'cucharada',
    };
    const teaspoon: InventoryPriceReference = {
      ...tablespoon,
      amount: '100',
      referenceUnit: 'cucharadita',
    };
    expect(
      selectIngredientPrice('Sal', [lot(tablespoon, 'Sal'), lot(teaspoon, 'Sal')])
    ).toMatchObject({ status: 'known' });
    expect(
      selectIngredientPrice('Sal', [
        lot(tablespoon, 'Sal'),
        lot({ ...teaspoon, amount: '300' }, 'Sal'),
      ])
    ).toEqual({ status: 'unknown' });
    expect(
      costRequirements(
        [{ ingredientName: 'Sal', quantity: '1', unit: 'cucharadita' }],
        [lot(tablespoon, 'Sal')],
        'COP'
      )
    ).toMatchObject({ status: 'complete', amount: '100.00' });
    expect(
      costRequirements(
        [{ ingredientName: 'Sal', quantity: '1', unit: 'cucharada' }],
        [lot(teaspoon, 'Sal')],
        'COP'
      )
    ).toMatchObject({ status: 'complete', amount: '300.00' });
  });
});
