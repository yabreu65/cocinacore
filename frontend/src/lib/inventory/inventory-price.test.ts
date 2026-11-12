import { describe, expect, it } from 'vitest';
import {
  calculateInventoryCost,
  isInventoryCurrency,
  readInventoryPrice,
  roundInventoryCost,
  suggestInventoryCurrency,
  validatePriceReference,
  type InventoryPriceReference,
} from './inventory-price';

const ricePrice: InventoryPriceReference = {
  amount: '4000',
  currency: 'COP',
  referenceQuantity: '1',
  referenceUnit: 'kg',
};

function costText(
  quantity: string,
  unit: string,
  price: InventoryPriceReference = ricePrice
): string {
  const result = calculateInventoryCost({ quantity, unit, price });
  if (result.status !== 'known') throw new Error(result.reason);
  return roundInventoryCost(result.cost);
}

describe('organization currency contract', () => {
  it.each(['ARS', 'COP', 'VES', 'USD', 'EUR', 'MXN', 'CLP', 'PEN'])('allows %s', (code) => {
    expect(isInventoryCurrency(code)).toBe(true);
  });
  it.each(['$', 'cop', 'ZZZ', 'constructor', null, 42])('rejects %s', (code) => {
    expect(isInventoryCurrency(code)).toBe(false);
  });
  it('suggests only from an explicit country; no fallback', () => {
    expect(suggestInventoryCurrency('co')).toBe('COP');
    expect(suggestInventoryCurrency('AR')).toBe('ARS');
    expect(suggestInventoryCurrency('BR')).toBeNull();
    expect(suggestInventoryCurrency('constructor')).toBeNull();
  });
});

describe('price reference', () => {
  it('normalizes PostgreSQL numeric strings, comma decimals and aliases', () => {
    expect(
      validatePriceReference({
        amount: '4000.0000',
        currency: 'COP',
        referenceQuantity: '0,5',
        referenceUnit: 'kilogramos',
      })
    ).toEqual({
      ok: true,
      price: { amount: '4000', currency: 'COP', referenceQuantity: '0.5', referenceUnit: 'kg' },
    });
  });
  it('allows zero price, not zero reference quantity', () => {
    expect(validatePriceReference({ ...ricePrice, amount: '0' })).toMatchObject({ ok: true });
    expect(validatePriceReference({ ...ricePrice, referenceQuantity: '0' })).toMatchObject({
      ok: false,
    });
  });
  it.each([
    { amount: '-1' },
    { amount: '1e4' },
    { amount: '' },
    { currency: '$' },
    { currency: null },
    { referenceQuantity: '-1' },
    { referenceQuantity: null },
    { referenceUnit: '500 gramos' },
    { referenceUnit: 'unknown' },
  ])('rejects partial or invalid reference %j', (patch) => {
    expect(validatePriceReference({ ...ricePrice, ...patch })).toMatchObject({ ok: false });
  });
  it('never invents currency or units for legacy prices', () => {
    expect(readInventoryPrice({ estimated_unit_price: '4000.0000' })).toEqual({
      status: 'unconfirmed',
      price: null,
    });
    expect(readInventoryPrice({ estimated_unit_price: null })).toEqual({
      status: 'missing',
      price: null,
    });
    expect(readInventoryPrice({ estimated_unit_price: '4000', price_currency: 'COP' })).toEqual({
      status: 'invalid',
      price: null,
    });
    expect(readInventoryPrice({ estimated_unit_price: null, price_currency: 'COP' })).toEqual({
      status: 'invalid',
      price: null,
    });
  });
  it('preserves stored currency independent of organization preference', () => {
    expect(
      readInventoryPrice({
        estimated_unit_price: '4000.0000',
        price_currency: 'COP',
        price_reference_quantity: '1.0000',
        price_reference_unit: 'kg',
      })
    ).toEqual({ status: 'known', price: ricePrice });
  });
});

describe('exact cost with compatible units', () => {
  it.each([
    ['500', 'g', '2000.00'],
    ['250', 'g', '1000.00'],
    ['0.5', 'kg', '2000.00'],
    ['0', 'g', '0.00'],
  ])('calculates %s %s', (quantity, unit, expected) => {
    expect(costText(quantity, unit)).toBe(expected);
  });
  it('supports arbitrary purchase presentations and volume conversions', () => {
    expect(
      costText('250', 'g', {
        ...ricePrice,
        amount: '2200',
        referenceQuantity: '500',
        referenceUnit: 'g',
      })
    ).toBe('1100.00');
    expect(costText('250', 'ml', { ...ricePrice, amount: '8000', referenceUnit: 'l' })).toBe(
      '2000.00'
    );
  });
  it('never converts mass to volume, package to weight, or unknown quantities', () => {
    expect(calculateInventoryCost({ quantity: '500', unit: 'ml', price: ricePrice })).toMatchObject(
      { status: 'unknown', reason: 'incompatible-unit' }
    );
    expect(
      calculateInventoryCost({ quantity: '1', unit: 'paquete', price: ricePrice })
    ).toMatchObject({ status: 'unknown', reason: 'incompatible-unit' });
    expect(calculateInventoryCost({ quantity: null, unit: 'g', price: ricePrice })).toMatchObject({
      status: 'unknown',
      reason: 'invalid-quantity',
    });
  });
  it('does not silently convert currencies', () => {
    expect(
      calculateInventoryCost({
        quantity: '500',
        unit: 'g',
        price: ricePrice,
        expectedCurrency: 'ARS',
      })
    ).toMatchObject({ status: 'unknown', reason: 'different-currency' });
  });
  it('rounds only at the final boundary, with currency precision', () => {
    const price: InventoryPriceReference = {
      amount: '1',
      currency: 'USD',
      referenceQuantity: '3',
      referenceUnit: 'unidad',
    };
    const result = calculateInventoryCost({ quantity: '1', unit: 'unidad', price });
    if (result.status !== 'known') throw new Error(result.reason);
    expect(result.cost.numerator * BigInt(3)).toBe(result.cost.denominator);
    expect(roundInventoryCost(result.cost)).toBe('0.33');
    expect(costText('1', 'unidad', { ...price, amount: '0.015', referenceQuantity: '1' })).toBe(
      '0.02'
    );
    expect(
      costText('1', 'unidad', { ...price, amount: '1.5', currency: 'CLP', referenceQuantity: '1' })
    ).toBe('2');
  });
  it('avoids overflow/precision loss at large valid quantities', () => {
    expect(
      costText('99999999.9999', 'kg', {
        ...ricePrice,
        amount: '99999999.9999',
        referenceQuantity: '0.0001',
        referenceUnit: 'g',
      })
    ).toBe('99999999999800000000000.10');
  });
});
