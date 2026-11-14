import {
  parseExactQuantity,
  subtractQuantity,
  quantityNumber,
  type ExactQuantity,
} from './exact-quantity';
// NUMERIC(12,4) stores at most eight integer and four fractional digits.
// No rounding of a real consumption amount: stock and audit must agree.
const SCALE = 10_000;
const MAX_TICKS = 999_999_999_999;

export function exactPersistableStockQuantity(value: number): number | null {
  const exact = parseExactQuantity(value);
  return exact ? exactStorageQuantity(exact) : null;
}

export function exactStorageQuantity(value: ExactQuantity): number | null {
  if (value.numerator < BigInt(0)) return null;
  const scaled = value.numerator * BigInt(SCALE);
  if (scaled % value.denominator !== BigInt(0)) return null;
  const ticks = scaled / value.denominator;
  return ticks <= BigInt(MAX_TICKS) ? Number(ticks) / SCALE : null;
}
export function planRationalStockDeduction(
  available: ExactQuantity,
  requested: ExactQuantity
):
  | { ok: true; quantity: number; remaining: number }
  | { ok: false; reason: 'precision' | 'insufficient' } {
  const stock = exactStorageQuantity(available);
  const quantity = exactStorageQuantity(requested);
  if (stock === null || quantity === null || quantity <= 0)
    return { ok: false, reason: 'precision' };
  const remaining = subtractQuantity(available, requested);
  if (remaining.numerator < BigInt(0)) return { ok: false, reason: 'insufficient' };
  return { ok: true, quantity, remaining: quantityNumber(remaining) };
}
