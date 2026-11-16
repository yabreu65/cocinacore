import { describe, expect, it } from 'vitest';
import {
  inventoryStockState,
  isValidInventoryExpirationDate,
  normalizeInventoryUnit,
  parseInventoryDecimal,
  validateInventoryFields,
} from './inventory-input';

describe('inventory input contract', () => {
  it.each([
    ['500', 500],
    ['0,5', 0.5],
    ['0', 0],
    ['99999999.9999', 99999999.9999],
    [' 2.2500 ', 2.25],
  ])('parses %s', (input, expected) => {
    expect(parseInventoryDecimal(input)).toBe(expected);
  });
  it.each([
    '-1',
    '500 gramos',
    '1e2',
    '1/2',
    '0.00001',
    '100000000',
    '1.2.3',
    'NaN',
    'Infinity',
    '',
  ])('rejects %s', (input) => {
    expect(parseInventoryDecimal(input)).toBeNull();
  });
  it.each([
    ['gramos', 'g'],
    ['kilogramos', 'kg'],
    ['litros', 'l'],
    ['unidades', 'unidad'],
    ['cucharaditas', 'cucharadita'],
    ['paquetes', 'paquete'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeInventoryUnit(input)).toBe(expected);
  });
  it.each(['500 gramos', 'tomate', 'caja de 12', 'otro', 'constructor', '__proto__'])(
    'rejects ambiguous unit %s',
    (input) => {
      expect(normalizeInventoryUnit(input)).toBeNull();
    }
  );
  it('keeps unknown quantity separate from zero', () => {
    expect(validateInventoryFields({})).toEqual({
      ok: true,
      quantity: null,
      unit: null,
      lowStockThreshold: null,
      estimatedUnitPrice: null,
    });
    expect(validateInventoryFields({ quantity: '0', unit: 'g' })).toMatchObject({
      ok: true,
      quantity: '0',
      unit: 'g',
    });
  });
  it('normalizes valid fields', () => {
    expect(
      validateInventoryFields({
        quantity: '0,5',
        unit: 'kilogramos',
        lowStockThreshold: '0,25',
        estimatedUnitPrice: '4000',
      })
    ).toEqual({
      ok: true,
      quantity: '0.5',
      unit: 'kg',
      lowStockThreshold: 0.25,
      estimatedUnitPrice: 4000,
    });
  });
  it.each([
    { quantity: '1', unit: '500 gramos' },
    { quantity: '1' },
    { quantity: '-1', unit: 'g' },
    { quantity: '500 g', unit: 'g' },
    { lowStockThreshold: '1' },
    { lowStockThreshold: '-1', unit: 'kg' },
    { estimatedUnitPrice: '-2' },
  ])('rejects invalid fields %j', (fields) => {
    expect(validateInventoryFields(fields)).toMatchObject({ ok: false });
  });
  it('classifies stock conservatively', () => {
    expect(inventoryStockState(null, null, null)).toBe('sin cantidad');
    expect(inventoryStockState('1', '500 gramos', null)).toBe('revisar cantidad');
    expect(inventoryStockState('0', 'g', null)).toBe('agotado');
    expect(inventoryStockState('2', 'kg', null)).toBe('disponible');
    expect(inventoryStockState('0.5', 'kg', '0.5000')).toBe('bajo stock');
    expect(inventoryStockState('1', 'kg', '0.5000')).toBe('suficiente');
    expect(inventoryStockState('1/2', 'kg', null)).toBe('revisar cantidad');
  });
});

describe('inventory expiration calendar validation', () => {
  it.each([undefined, null, '', '2026-11-12', '2028-02-29'])('accepts %s', (value) => {
    expect(isValidInventoryExpirationDate(value)).toBe(true);
  });
  it.each([
    '0000-01-01',
    '2026-02-29',
    '2026-02-30',
    '2026-13-01',
    '12/11/2026',
    ' 2026-11-12',
    '2026-11-12T00:00:00.000Z',
  ])('rejects %s', (value) => {
    expect(isValidInventoryExpirationDate(value)).toBe(false);
  });
});
