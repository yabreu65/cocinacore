import { describe, expect, it } from 'vitest';
import {
  canCompareUnits,
  compareInventoryToRequirement,
  convertQuantity,
  convertExactQuantity,
  parseQuantity,
  parseExplicitQuantity,
} from './quantity-normalization';
import { parseExactQuantity, exactQuantityText } from './exact-quantity';

describe('quantity-normalization', () => {
  it('parses common quantity formats', () => {
    expect(parseQuantity('3')).toMatchObject({ value: 3, unit: 'unidad', structured: true });
    expect(parseQuantity('3 unidades')).toMatchObject({
      value: 3,
      unit: 'unidad',
      structured: true,
    });
    expect(parseQuantity('3 tomates')).toMatchObject({
      value: 3,
      unit: 'unidad',
      structured: true,
    });
    expect(parseQuantity('1 kg')).toMatchObject({ value: 1, unit: 'kg', structured: true });
    expect(parseQuantity('500 g')).toMatchObject({ value: 500, unit: 'g', structured: true });
    expect(parseQuantity('0.5 kg')).toMatchObject({ value: 0.5, unit: 'kg', structured: true });
    expect(parseQuantity('1/2 kg')).toMatchObject({ value: 0.5, unit: 'kg', structured: true });
    expect(parseQuantity('2 litros')).toMatchObject({ value: 2, unit: 'l', structured: true });
    expect(parseQuantity('250 ml')).toMatchObject({ value: 250, unit: 'ml', structured: true });
    expect(parseQuantity('1 paquete')).toMatchObject({
      value: 1,
      unit: 'paquete',
      structured: true,
    });
    expect(parseQuantity('al gusto')).toMatchObject({ structured: false });
    expect(parseQuantity('')).toMatchObject({ structured: false });
  });

  it.each([
    ['1 1/2 kg', 1.5, 'kg'],
    ['1 / 2 kg', 0.5, 'kg'],
    ['1 1 / 2 kg', 1.5, 'kg'],
    ['0,5 KILOS', 0.5, 'kg'],
    ['500 g', 500, 'g'],
    ['3 unidades', 3, 'unidad'],
    ['2 litros', 2, 'l'],
    ['1 paquete', 1, 'paquete'],
    ['0.0001 kg', 0.0001, 'kg'],
    ['1/10000 kg', 0.0001, 'kg'],
    ['99999999.9999 kg', 99999999.9999, 'kg'],
    ['1.234500000 kg', 1.2345, 'kg'],
  ])('accepts an explicit complete quantity %s', (raw, value, unit) => {
    expect(parseExplicitQuantity(raw)).toEqual({ value, unit });
  });

  it.each([
    '1 1/2',
    '1 / 2',
    '1/2',
    '3',
    '0,5',
    '1 bolsa',
    '1 tomate',
    '1 tomates',
    '1 kg extra',
    '1 kg g',
    '1/0 kg',
    '0 kg',
    '-1 kg',
    '1 constructor',
    '1 __proto__',
    'al gusto',
    '',
  ])('rejects missing, unsupported or ambiguous units: %s', (raw) => {
    expect(parseExplicitQuantity(raw)).toBeNull();
  });

  it.each([
    '1/3 kg',
    '0.00001 kg',
    '1/100000 kg',
    '0.00015 kg',
    '100000000 kg',
    '99999999.99995 kg',
    '1.00000000000000000001 kg',
    '9007199254740993 kg',
    '1e2 kg',
    '0.000099999999999999999 kg',
  ])('rejects amounts that cannot be stored exactly: %s', (raw) => {
    expect(parseExplicitQuantity(raw)).toBeNull();
  });

  it('preserves legacy inferred recipe quantities', () => {
    expect(parseQuantity('1 1/2')).toMatchObject({ value: 1.5, unit: 'unidad' });
    expect(parseQuantity('3 tomates')).toMatchObject({ value: 3, unit: 'unidad' });
  });

  it('compares and converts compatible units', () => {
    expect(canCompareUnits('kg', 'g')).toBe(true);
    expect(convertQuantity(1, 'kg', 'g')).toBe(1000);
    expect(convertQuantity(500, 'ml', 'l')).toBe(0.5);
    expect(canCompareUnits('g', 'ml')).toBe(false);
  });

  it.each([
    ['kg', 'g', '1', '1000'],
    ['g', 'kg', '500', '0.5'],
    ['l', 'ml', '1', '1000'],
    ['ml', 'l', '250', '0.25'],
    ['cucharada', 'cucharadita', '1', '3'],
    ['cucharadita', 'cucharada', '3', '1'],
    ['cucharadita', 'cucharada', '1', '1/3'],
    ['unidad', 'unidad', '2', '2'],
    ['paquete', 'paquete', '2', '2'],
    ['taza', 'taza', '2', '2'],
  ] as const)('converts %s to %s exactly (%s)', (from, to, amount, expected) => {
    const converted = convertExactQuantity(parseExactQuantity(amount)!, from, to);
    expect(converted && exactQuantityText(converted)).toBe(expected);
  });
  it.each([
    ['g', 'ml'],
    ['taza', 'ml'],
    ['cucharada', 'ml'],
    ['unidad', 'paquete'],
    ['unknown', 'unknown'],
  ] as const)('does not invent conversion between %s and %s', (from, to) => {
    expect(convertExactQuantity(parseExactQuantity('1')!, from, to)).toBeNull();
  });
  it('keeps legacy numeric spoon conversion consistent with exact units', () => {
    expect(convertQuantity(1, 'cucharada', 'cucharadita')).toBe(3);
    expect(convertQuantity(3, 'cucharadita', 'cucharada')).toBe(1);
  });

  it('returns meaningful comparison status', () => {
    expect(
      compareInventoryToRequirement(
        { quantity: '1 kg', unit: null },
        { quantity: '500 g', unit: null }
      ).status
    ).toBe('sufficient');

    expect(
      compareInventoryToRequirement(
        { quantity: '250 g', unit: null },
        { quantity: '500 g', unit: null }
      ).status
    ).toBe('partial');

    expect(
      compareInventoryToRequirement(
        { quantity: 'al gusto', unit: null },
        { quantity: '1 kg', unit: null }
      ).status
    ).toBe('unknown');
  });
});
