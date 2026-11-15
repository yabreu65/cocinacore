import {
  compareQuantity,
  exactQuantityText,
  parseExactQuantity,
  quantityNumber,
  type ExactQuantity,
} from '@/lib/inventory/exact-quantity';
import { parseExactStoredQuantity } from '@/lib/inventory/quantity-normalization';
import { normalizeIngredientName } from './ingredient-name';

/** The numeric DTO is a projection, not a rounded substitute for source evidence. */
export function projectExactRecipeAmount(text: string): { exact: ExactQuantity; quantity: number | null } | null {
  if (text.length > 100 || text.trim() !== text || /[\u0000-\u001f\u007f\u2028\u2029]/u.test(text)) return null;
  const exact = parseExactQuantity(text);
  if (!exact || exact.numerator <= BigInt(0)) return null;
  const numeric = quantityNumber(exact);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const roundTrip = parseExactQuantity(numeric);
  return { exact, quantity: roundTrip && compareQuantity(exact, roundTrip) === 0 ? numeric : null };
}

/** Invalid or contradictory explicit evidence must not fall back to a numeric guess. */
export function readExactRecipeAmount(text: unknown, quantity: unknown, note?: unknown): ExactQuantity | null {
  if (typeof text !== 'string' || note != null) return null;
  const projection = projectExactRecipeAmount(text);
  return projection && projection.quantity === quantity ? projection.exact : null;
}

/** Persistence uses text, so fractions and small decimals survive without rounding. */
export function recipeAmountForImport(quantity: unknown, exactText?: unknown, note?: unknown, ingredientName?: string): string | null {
  if (exactText !== undefined) {
    return typeof exactText === 'string' && readExactRecipeAmount(exactText, quantity, note) ? exactText : null;
  }
  if (quantity === null && typeof note === 'string') {
    const text = note.trim();
    // The legacy text parser duplicated the entire ingredient line as its
    // note. That is not independent evidence of an amount.
    if (ingredientName !== undefined &&
        normalizeIngredientName(text) === normalizeIngredientName(ingredientName)) return null;
    // Manual recipes already support qualitative amount strings. Never turn
    // an ambiguous or numeric note into an exact stock amount.
    if (!text || text.length > 100 || /[\u0000-\u001f\u007f\u2028\u2029]/u.test(text) ||
        parseExactQuantity(text) || parseExactStoredQuantity({ quantity: text, unit: null })) return null;
    return text;
  }
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity < 0 || note != null) return null;
  const exact = parseExactQuantity(quantity);
  const text = exact ? exactQuantityText(exact) : null;
  return text && text.length <= 100 ? text : null;
}
