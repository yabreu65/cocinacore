import { describe, expect, it } from 'vitest';
import { planRationalStockDeduction } from './stock-precision';
import { addQuantity, parseExactQuantity } from './exact-quantity';
const plan = (available: number, requested: number) =>
  planRationalStockDeduction(parseExactQuantity(available)!, parseExactQuantity(requested)!);

describe('exact persisted stock deduction', () => {
  it('does not turn a positive amount into a zero movement', () => {
    expect(plan(1, 0.00001)).toEqual({ ok: false, reason: 'precision' });
    expect(plan(1, 0.00015)).toEqual({ ok: false, reason: 'precision' });
    expect(plan(1, 0.0001)).toEqual({
      ok: true,
      quantity: 0.0001,
      remaining: 0.9999,
    });
  });
  it('never rounds existing legacy stock or deducts more than it contains', () => {
    expect(plan(1.00001, 0.5)).toEqual({ ok: false, reason: 'precision' });
    expect(plan(0.9999, 1)).toEqual({ ok: false, reason: 'insufficient' });
    expect(
      planRationalStockDeduction(
        parseExactQuantity('0.3')!,
        addQuantity(parseExactQuantity('0.1')!, parseExactQuantity('0.2')!)
      )
    ).toEqual({
      ok: true,
      quantity: 0.3,
      remaining: 0,
    });
    expect(plan(100000000, 1)).toEqual({ ok: false, reason: 'precision' });
  });
});
