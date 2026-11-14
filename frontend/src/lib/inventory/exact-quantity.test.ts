import { exactStorageQuantity, planRationalStockDeduction } from './stock-precision';
import { describe, it, expect } from 'vitest';
import {
  addQuantity,
  parseExactQuantity,
  divideQuantity,
  compareQuantity,
  quantityNumber,
} from './exact-quantity';

describe('exact quantity domain contract', () => {
  it('adds decimals and fractions without false shortfalls', () => {
    const sum = addQuantity(parseExactQuantity('0.1')!, parseExactQuantity('0.2')!);
    expect(compareQuantity(sum, parseExactQuantity('0.3')!)).toBe(0);
    const third = divideQuantity(parseExactQuantity('1')!, parseExactQuantity('3')!);
    expect(
      compareQuantity(addQuantity(addQuantity(third, third), third), parseExactQuantity('1')!)
    ).toBe(0);
  });
  it('does not allow approximate decimals or nonterminating fractions into persisted stock', () => {
    expect(exactStorageQuantity(parseExactQuantity('1/3')!)).toBeNull();
    expect(exactStorageQuantity(parseExactQuantity('0.00004')!)).toBeNull();
    expect(
      planRationalStockDeduction(
        parseExactQuantity('0.3')!,
        addQuantity(parseExactQuantity('0.1')!, parseExactQuantity('0.2')!)
      )
    ).toEqual({ ok: true, quantity: 0.3, remaining: 0 });
    expect(
      planRationalStockDeduction(parseExactQuantity('0.3')!, parseExactQuantity('0.00004')!)
    ).toEqual({ ok: false, reason: 'precision' });
  });
  it('parses mixed fractions exactly without binary floating point', () => {
    expect(quantityNumber(parseExactQuantity('1 1/2')!)).toBe(1.5);
    expect(compareQuantity(parseExactQuantity('1 / 2')!, parseExactQuantity('0.5')!)).toBe(0);
    expect(parseExactQuantity('1/0')).toBeNull();
  });
});
