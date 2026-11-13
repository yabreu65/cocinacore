import type { ExactInventoryCost } from './inventory-price';

function gcd(a: bigint, b: bigint): bigint {
  while (b !== BigInt(0)) {
    [a, b] = [b, a % b];
  }
  return a;
}

export function addCost(a: ExactInventoryCost, b: ExactInventoryCost): ExactInventoryCost {
  if (a.currency !== b.currency) throw new Error('Incompatible currencies');
  const divisor = gcd(a.denominator, b.denominator);
  const denominator = (a.denominator / divisor) * b.denominator;
  const numerator =
    a.numerator * (b.denominator / divisor) + b.numerator * (a.denominator / divisor);
  const reduced = gcd(numerator, denominator);
  return {
    currency: a.currency,
    numerator: numerator / reduced,
    denominator: denominator / reduced,
  };
}
