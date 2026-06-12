import { describe, expect, it } from 'vitest';
import {
  canCompareUnits,
  compareInventoryToRequirement,
  convertQuantity,
  parseQuantity,
} from './quantity-normalization';

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

  it('compares and converts compatible units', () => {
    expect(canCompareUnits('kg', 'g')).toBe(true);
    expect(convertQuantity(1, 'kg', 'g')).toBe(1000);
    expect(convertQuantity(500, 'ml', 'l')).toBe(0.5);
    expect(canCompareUnits('g', 'ml')).toBe(false);
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
