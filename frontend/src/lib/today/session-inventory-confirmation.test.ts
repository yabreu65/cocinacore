import { describe, expect, it } from 'vitest';
import { assessSessionInventoryQuantity } from './session-inventory-confirmation';

describe('assessSessionInventoryQuantity', () => {
  it('keeps an unconfirmed registered quantity unknown', () => {
    expect(assessSessionInventoryQuantity(1, 2, false)).toBe('unknown');
  });

  it('requires a user-confirmed quantity before declaring sufficient', () => {
    expect(assessSessionInventoryQuantity(1, 1, true)).toBe('sufficient');
    expect(assessSessionInventoryQuantity(1, 2, true)).toBe('sufficient');
  });

  it('accepts explicitly confirmed zero as missing, not as an inferred absence', () => {
    expect(assessSessionInventoryQuantity(1, 0, true)).toBe('missing');
  });

  it('keeps a confirmed positive but insufficient amount partial', () => {
    expect(assessSessionInventoryQuantity(1, 0.5, true)).toBe('partial');
  });

  it('fails closed for unknown requirements, empty, negative, or non-finite quantities', () => {
    expect(assessSessionInventoryQuantity(null, 2, true)).toBe('unknown');
    expect(assessSessionInventoryQuantity(1, null, true)).toBe('unknown');
    expect(assessSessionInventoryQuantity(1, -1, true)).toBe('unknown');
    expect(assessSessionInventoryQuantity(1, Number.NaN, true)).toBe('unknown');
  });
});
