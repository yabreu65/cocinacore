import { parseInventoryDecimal } from './inventory-input';
import {
  calculateInventoryCost,
  readInventoryPrice,
  roundInventoryCost,
  type ExactInventoryCost,
  type InventoryCurrency,
  type InventoryPriceReference,
  type StoredInventoryPrice,
} from './inventory-price';
import { addCost } from './exact-inventory-cost';
import { normalizeInventoryName } from './normalize-inventory';
import { quantityBaseUnit, quantityUnitFactor } from './quantity-normalization';

export type CostCoverage = Readonly<{
  status: 'complete' | 'partial' | 'unknown';
  currency: InventoryCurrency | null;
  amount: string | null;
  knownCount: number;
  totalCount: number;
}>;

export type CostRequirement = Readonly<{
  ingredientName: string;
  quantity: string | number | null;
  unit: string | null;
}>;

export type InventoryCostLot = StoredInventoryPrice & Readonly<{ ingredient_name: string }>;

function normalizedUnitRate(price: InventoryPriceReference): string {
  // Share the exact conversion basis used by inventory deductions.
  const multiplier = quantityUnitFactor(price.referenceUnit);
  const amount = parseInventoryDecimal(price.amount);
  const quantity = parseInventoryDecimal(price.referenceQuantity);
  if (amount === null || quantity === null || quantity <= 0) return '';
  const toScaled = (value: number) => {
    const [whole, fraction = ''] = String(value).split('.');
    return BigInt(whole) * BigInt(10000) + BigInt(fraction.padEnd(4, '0'));
  };
  const numerator = toScaled(amount);
  const denominator = toScaled(quantity) * multiplier;
  const gcd = (a: bigint, b: bigint): bigint => (b === BigInt(0) ? a : gcd(b, a % b));
  const divisor = gcd(numerator, denominator);
  const basis = quantityBaseUnit(price.referenceUnit);
  return `${basis}:${numerator / divisor}/${denominator / divisor}`;
}

export function selectIngredientPrice(
  ingredientName: string,
  lots: readonly InventoryCostLot[]
): { status: 'known'; price: InventoryPriceReference } | { status: 'unknown' } {
  const target = normalizeInventoryName(ingredientName);
  const matching = lots.filter((lot) => normalizeInventoryName(lot.ingredient_name) === target);
  if (!target || matching.length === 0) return { status: 'unknown' };
  const states = matching.map((lot) => readInventoryPrice(lot));
  if (states.some((state) => state.status !== 'known')) return { status: 'unknown' };
  const prices = states.map((state) => (state.status === 'known' ? state.price : null));
  const first = prices[0];
  if (
    !first ||
    prices.some(
      (price) =>
        !price ||
        price.currency !== first.currency ||
        normalizedUnitRate(price) !== normalizedUnitRate(first)
    )
  )
    return { status: 'unknown' };
  return { status: 'known', price: first };
}

export function summarizeCosts(
  costs: readonly ({ status: 'known'; cost: ExactInventoryCost } | { status: 'unknown' })[],
  currency: InventoryCurrency | null
): CostCoverage {
  const known = costs.filter(
    (item): item is { status: 'known'; cost: ExactInventoryCost } => item.status === 'known'
  );
  const totalCount = costs.length;
  const matching = currency === null ? [] : known.filter(({ cost }) => cost.currency === currency);
  if (totalCount > 0 && matching.length === 0)
    return { status: 'unknown', currency, amount: null, knownCount: 0, totalCount };
  let total: ExactInventoryCost | null = null;
  for (const { cost } of matching) total = total ? addCost(total, cost) : cost;
  const status = matching.length === totalCount ? 'complete' : 'partial';
  return {
    status,
    currency,
    amount: total
      ? roundInventoryCost(total)
      : currency
        ? roundInventoryCost({ currency, numerator: BigInt(0), denominator: BigInt(1) })
        : null,
    knownCount: matching.length,
    totalCount,
  };
}

export function costRequirements(
  requirements: readonly CostRequirement[],
  lots: readonly InventoryCostLot[],
  currency: InventoryCurrency | null
): CostCoverage {
  if (requirements.length === 0) return summarizeCosts([], currency);
  const costs = requirements.map((requirement) => {
    const selected = selectIngredientPrice(requirement.ingredientName, lots);
    if (selected.status !== 'known') return { status: 'unknown' as const };
    const result = calculateInventoryCost({
      quantity: requirement.quantity,
      unit: requirement.unit,
      price: selected.price,
      ...(currency ? { expectedCurrency: currency } : {}),
    });
    return result.status === 'known' ? result : { status: 'unknown' as const };
  });
  return summarizeCosts(costs, currency);
}

function decimalFraction(value: number): { numerator: bigint; denominator: bigint } {
  const [whole, fraction = ''] = String(value).split('.');
  const denominator = BigInt(10) ** BigInt(fraction.length);
  return {
    numerator: BigInt(whole) * denominator + BigInt(fraction || '0'),
    denominator,
  };
}

export function costRecipePortions(input: {
  requirements: readonly CostRequirement[];
  recipeServings: string | number;
  requestedServings: string | number;
  lots: readonly InventoryCostLot[];
  currency: InventoryCurrency | null;
}): CostCoverage {
  const base = parseInventoryDecimal(input.recipeServings);
  const requested = parseInventoryDecimal(input.requestedServings);
  if (base === null || requested === null || base <= 0 || requested <= 0)
    return {
      status: 'unknown',
      currency: input.currency,
      amount: null,
      knownCount: 0,
      totalCount: input.requirements.length,
    };
  const baseFraction = decimalFraction(base);
  const requestedFraction = decimalFraction(requested);
  const scaleNumerator = requestedFraction.numerator * baseFraction.denominator;
  const scaleDenominator = requestedFraction.denominator * baseFraction.numerator;
  const costs = input.requirements.map((requirement) => {
    const selected = selectIngredientPrice(requirement.ingredientName, input.lots);
    if (selected.status !== 'known') return { status: 'unknown' as const };
    const result = calculateInventoryCost({
      quantity: requirement.quantity,
      unit: requirement.unit,
      price: selected.price,
      ...(input.currency ? { expectedCurrency: input.currency } : {}),
    });
    if (result.status !== 'known') return { status: 'unknown' as const };
    return {
      status: 'known' as const,
      cost: {
        currency: result.cost.currency,
        numerator: result.cost.numerator * scaleNumerator,
        denominator: result.cost.denominator * scaleDenominator,
      },
    };
  });
  return summarizeCosts(costs, input.currency);
}
