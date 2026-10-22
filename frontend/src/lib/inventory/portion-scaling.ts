import { canCompareUnits, formatQuantity, normalizeUnit, parseQuantity } from './quantity-normalization';

export interface ScaledRecipeIngredient {
  source: string;
  text: string;
  scaled: boolean;
}

export interface PortionScalingResult {
  status: 'scaled' | 'partial' | 'unknown';
  factor: number | null;
  ingredients: ScaledRecipeIngredient[];
}

const MAX_TARGET_SERVINGS = 100;

function isPositiveFinite(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

function isValidTarget(value: number | null): value is number {
  return value !== null && Number.isInteger(value) && value >= 1 && value <= MAX_TARGET_SERVINGS;
}

function scaleIngredient(source: string, factor: number): ScaledRecipeIngredient {
  const match = source.match(/^\s*((?:\d+\s+\d+\/\d+)|(?:\d+\/\d+)|(?:\d+(?:[.,]\d+)?))\s+(\S+)(?:\s+(.*?))?\s*$/u);
  if (!match) return { source, text: source, scaled: false };

  const amountText = match[1];
  const unitText = match[2];
  const suffix = match[3] ?? '';
  const parsed = parseQuantity(`${amountText} ${unitText}`);
  const normalizedUnit = normalizeUnit(unitText);
  if (
    !parsed.structured ||
    parsed.value === null ||
    normalizedUnit === 'unknown' ||
    !canCompareUnits(normalizedUnit, normalizedUnit)
  ) return { source, text: source, scaled: false };

  const scaledValue = parsed.value * factor;
  const roundedValue = Math.round((scaledValue + Number.EPSILON) * 100) / 100;
  if (!Number.isFinite(roundedValue) || (parsed.value > 0 && roundedValue === 0)) {
    return { source, text: source, scaled: false };
  }

  const formattedValue = formatQuantity(roundedValue, 'unknown');
  const text = `${formattedValue} ${unitText}${suffix ? ` ${suffix}` : ''}`;
  return { source, text, scaled: true };
}

export function scaleRecipeIngredients(
  ingredients: readonly string[],
  baseServings: number | null,
  targetServings: number | null,
): PortionScalingResult {
  if (!isPositiveFinite(baseServings) || !isValidTarget(targetServings)) {
    return {
      status: 'unknown',
      factor: null,
      ingredients: ingredients.map((source) => ({ source, text: source, scaled: false })),
    };
  }

  const factor = targetServings / baseServings;
  const scaledIngredients = ingredients.map((source) => scaleIngredient(source, factor));
  const scaledCount = scaledIngredients.filter((ingredient) => ingredient.scaled).length;

  return {
    status: scaledCount === 0 ? 'unknown' : scaledCount === scaledIngredients.length ? 'scaled' : 'partial',
    factor,
    ingredients: scaledIngredients,
  };
}
