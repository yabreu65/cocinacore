import { parseExplicitRecipeLine } from './quantity-normalization';
import {
  divideQuantity,
  exactQuantityText,
  multiplyQuantity,
  parseExactQuantity,
  quantityNumber,
  type ExactQuantity,
} from './exact-quantity';

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

/** A single factor for text and structured recipes. */
export function recipePortionFactor(
  baseServings: number | null,
  targetServings: number | null
): ExactQuantity | null {
  if (!isPositiveFinite(baseServings) || !isValidTarget(targetServings)) return null;
  const base = parseExactQuantity(baseServings);
  const target = parseExactQuantity(targetServings);
  if (!base || !target || base.numerator <= BigInt(0)) return null;
  const factor = divideQuantity(target, base);
  const numeric = quantityNumber(factor);
  return Number.isFinite(numeric) && numeric > 0 ? factor : null;
}

function scaleIngredient(source: string, factor: ExactQuantity): ScaledRecipeIngredient {
  const parsed = parseExplicitRecipeLine(source);
  if (!parsed.amount) return { source, text: source, scaled: false };
  const quantity = exactQuantityText(multiplyQuantity(parsed.amount, factor));
  if (quantity.length > 100) return { source, text: source, scaled: false };
  return { source, text: `${quantity} ${parsed.unit} ${parsed.name}`, scaled: true };
}

export function scaleRecipeIngredients(
  ingredients: readonly string[],
  baseServings: number | null,
  targetServings: number | null
): PortionScalingResult {
  const exactFactor = recipePortionFactor(baseServings, targetServings);
  if (!exactFactor) {
    return {
      status: 'unknown',
      factor: null,
      ingredients: ingredients.map((source) => ({ source, text: source, scaled: false })),
    };
  }
  const factor = quantityNumber(exactFactor);
  const scaledIngredients = ingredients.map((source) => scaleIngredient(source, exactFactor));
  const scaledCount = scaledIngredients.filter((ingredient) => ingredient.scaled).length;

  return {
    status:
      scaledCount === 0
        ? 'unknown'
        : scaledCount === scaledIngredients.length
          ? 'scaled'
          : 'partial',
    factor,
    ingredients: scaledIngredients,
  };
}
