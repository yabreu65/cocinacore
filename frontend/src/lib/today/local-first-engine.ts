import { containsRestrictedIngredientName } from '../recipes/structured-ingredients';
import {
  compareRecipeRequirementsToInventory,
  normalizeRecipeIngredient,
  type ComparedRequirement,
  type InventoryComparableItem,
} from '../inventory/recipe-requirements';
import { normalizeInventoryName } from '../inventory/normalize-inventory';
import type { NormalizedUnit } from '../inventory/quantity-normalization';
import { rankOneSlotOptions, TODAY_SLOT_VALUES, type TodayOptionSource, type TodaySlot } from './one-slot';

export type LocalFirstSource = TodayOptionSource | 'saved_recipe';
export type LocalFirstAvailability = 'sufficient' | 'partial' | 'missing' | 'unknown';
export type LocalFirstQuantityProvenance = 'ai_estimate' | 'unknown';

export type LocalFirstIngredient = string | {
  name: string;
  quantity?: number | null;
  unit?: string | null;
};

export interface LocalFirstIngredientAvailability {
  name: string;
  availability: LocalFirstAvailability;
  quantityProvenance?: LocalFirstQuantityProvenance;
  present: boolean;
  requiredQuantity: number | null;
  requiredUnit: NormalizedUnit;
  availableQuantity: number | null;
  availableUnit: NormalizedUnit;
  missingQuantity: number | null;
  remainingQuantity: number | null;
}

export interface LocalFirstCandidate {
  id: string;
  title: string;
  slot: TodaySlot;
  ingredients: readonly LocalFirstIngredient[];
  prepMinutes: number | null;
  servings?: number | null;
  source: LocalFirstSource;
  quantityProvenance?: LocalFirstQuantityProvenance;
  identity?: { userId: string; tenantId: string };
  plannedDate?: string | null;
}

export interface LocalFirstInventoryItem extends InventoryComparableItem {
  expiresOn?: string;
}

export interface LocalFirstPlannedMeal {
  recipeId?: string;
  title?: string;
  date: string;
  slot: TodaySlot;
}

export interface LocalFirstInput {
  asOf: string;
  slot: TodaySlot;
  maxPrepMinutes: number;
  userId: string;
  tenantId: string;
  allergies: readonly string[];
  hardAvoid: readonly string[];
  dislikedIngredients: readonly string[];
  preferred: readonly string[];
  recentTitles: readonly string[];
  inventory: readonly LocalFirstInventoryItem[];
  candidates: readonly LocalFirstCandidate[];
  plannedMeals: readonly LocalFirstPlannedMeal[];
  providerStatus: 'available' | 'unavailable';
}

export interface LocalFirstRecommendation extends LocalFirstCandidate {
  availability: LocalFirstAvailability;
  ingredientAvailability: LocalFirstIngredientAvailability[];
  provenance: LocalFirstSource;
  reason: string[];
  uncertainty: { inventory: boolean; prepTime: boolean; planDate: boolean };
}

export type LocalFirstResult =
  | { status: 'ready'; recommendations: LocalFirstRecommendation[] }
  | { status: 'invalid'; reason: 'invalid-input'; recommendations: [] };

interface ScoredRecommendation {
  recommendation: LocalFirstRecommendation;
  availabilityRank: number;
  timeRank: number;
  preferredCount: number;
  dislikedCount: number;
  recentRepeat: boolean;
  sourceRank: number;
  inputIndex: number;
}

const SLOT_SET = new Set<TodaySlot>(TODAY_SLOT_VALUES);
const SOURCE_RANK: Record<LocalFirstSource, number> = {
  saved_recipe: 0,
  history: 1,
  saved_plan: 2,
  provider: 3,
};
const AVAILABILITY_RANK: Record<LocalFirstAvailability, number> = {
  sufficient: 0,
  partial: 1,
  unknown: 2,
  missing: 3,
};
const MAX_CANDIDATES = 100;
const MAX_INVENTORY = 50;
const MAX_INGREDIENTS = 30;
const MAX_RESTRICTIONS = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function isStringList(value: unknown, maxItems: number): value is readonly string[] {
  return Array.isArray(value) && value.length <= maxItems && value.every(
    (item) => typeof item === 'string' && item.trim().length > 0 && item.length <= 100
  );
}

function isSlot(value: unknown): value is TodaySlot {
  return typeof value === 'string' && SLOT_SET.has(value as TodaySlot);
}

function isSource(value: unknown): value is LocalFirstSource {
  return value === 'saved_recipe' || value === 'provider' || value === 'history' || value === 'saved_plan';
}

function isQuantityProvenance(value: unknown): value is LocalFirstQuantityProvenance {
  return value === 'ai_estimate' || value === 'unknown';
}

function isIdentity(value: unknown): value is { userId: string; tenantId: string } {
  return isRecord(value) && typeof value.userId === 'string' && typeof value.tenantId === 'string';
}

function validIdentity(value: unknown, input: LocalFirstInput, source: LocalFirstSource): boolean {
  if (source === 'provider' && value === undefined) return true;
  return isIdentity(value) && value.userId === input.userId && value.tenantId === input.tenantId;
}

function validIngredient(value: unknown): value is LocalFirstIngredient {
  if (typeof value === 'string') return value.trim().length > 0 && value.length <= 160;
  if (!isRecord(value) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120) return false;
  if (value.quantity !== undefined && value.quantity !== null &&
    (typeof value.quantity !== 'number' || !Number.isFinite(value.quantity) || value.quantity < 0)) return false;
  if (value.unit !== undefined && value.unit !== null &&
    (typeof value.unit !== 'string' || value.unit.length > 40)) return false;
  return true;
}

function ingredientName(ingredient: LocalFirstIngredient): string {
  return typeof ingredient === 'string' ? ingredient.trim() : ingredient.name.trim();
}

function cloneIngredient(ingredient: LocalFirstIngredient): LocalFirstIngredient {
  return typeof ingredient === 'string' ? ingredient : { ...ingredient };
}

function parseCandidate(value: unknown, input: LocalFirstInput): LocalFirstCandidate | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim() || value.id.length > 160 ||
    typeof value.title !== 'string' || !value.title.trim() || value.title.length > 120 ||
    !isSlot(value.slot) || !isSource(value.source) || value.slot !== input.slot ||
    !validIdentity(value.identity, input, value.source) || !Array.isArray(value.ingredients) ||
    value.ingredients.length === 0 || value.ingredients.length > MAX_INGREDIENTS ||
    !value.ingredients.every(validIngredient)) return null;
  if (value.prepMinutes !== null && (typeof value.prepMinutes !== 'number' ||
    !Number.isInteger(value.prepMinutes) || value.prepMinutes < 1 || value.prepMinutes > 240)) return null;
  if (value.servings !== undefined && value.servings !== null &&
    (typeof value.servings !== 'number' || !Number.isFinite(value.servings) || value.servings <= 0)) return null;
  if (value.plannedDate !== undefined && value.plannedDate !== null && !isIsoDate(value.plannedDate)) return null;
  if (value.quantityProvenance !== undefined && !isQuantityProvenance(value.quantityProvenance)) return null;
  return {
    id: value.id.trim(),
    title: value.title.trim(),
    slot: value.slot,
    ingredients: value.ingredients.map((ingredient) => cloneIngredient(ingredient)),
    prepMinutes: value.prepMinutes,
    ...(value.servings === undefined ? {} : { servings: value.servings }),
    source: value.source,
    ...(isQuantityProvenance(value.quantityProvenance) ? { quantityProvenance: value.quantityProvenance } : {}),
    ...(isIdentity(value.identity) ? {
      identity: { userId: value.identity.userId, tenantId: value.identity.tenantId },
    } : {}),
    ...(value.plannedDate === undefined ? {} : { plannedDate: value.plannedDate }),
  };
}

function validInput(value: unknown): value is LocalFirstInput {
  if (!isRecord(value) || !isIsoDate(value.asOf) || !isSlot(value.slot) ||
    typeof value.maxPrepMinutes !== 'number' || !Number.isInteger(value.maxPrepMinutes) ||
    value.maxPrepMinutes < 1 || value.maxPrepMinutes > 240 ||
    typeof value.userId !== 'string' || !value.userId.trim() ||
    typeof value.tenantId !== 'string' || !value.tenantId.trim() ||
    !isStringList(value.allergies, MAX_RESTRICTIONS) ||
    !isStringList(value.hardAvoid, MAX_RESTRICTIONS) ||
    !isStringList(value.dislikedIngredients, MAX_RESTRICTIONS) ||
    !isStringList(value.preferred, MAX_RESTRICTIONS) ||
    !isStringList(value.recentTitles, MAX_RESTRICTIONS) ||
    !Array.isArray(value.inventory) || value.inventory.length > MAX_INVENTORY ||
    !Array.isArray(value.candidates) || value.candidates.length > MAX_CANDIDATES ||
    !Array.isArray(value.plannedMeals) || value.plannedMeals.length > MAX_CANDIDATES ||
    (value.providerStatus !== 'available' && value.providerStatus !== 'unavailable')) return false;
  for (const item of value.inventory) {
    if (!isRecord(item) || typeof item.ingredient_name !== 'string' || !item.ingredient_name.trim() ||
      (item.quantity !== null && typeof item.quantity !== 'string') ||
      (item.unit !== null && typeof item.unit !== 'string') ||
      (item.expiresOn !== undefined && !isIsoDate(item.expiresOn))) return false;
  }
  for (const meal of value.plannedMeals) {
    if (!isRecord(meal) || !isIsoDate(meal.date) || !isSlot(meal.slot) ||
      (meal.recipeId !== undefined && (typeof meal.recipeId !== 'string' || !meal.recipeId.trim())) ||
      (meal.title !== undefined && (typeof meal.title !== 'string' || !meal.title.trim()))) return false;
  }
  return true;
}

function normalizedTitle(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function isAlreadyPlanned(candidate: LocalFirstCandidate, input: LocalFirstInput): boolean {
  return input.plannedMeals.some((meal) => {
    if (meal.date !== input.asOf || meal.slot !== input.slot) return false;
    if (meal.recipeId && candidate.id === meal.recipeId) return true;
    return Boolean(meal.title && normalizedTitle(candidate.title) === normalizedTitle(meal.title));
  });
}

function availabilityFor(
  candidate: LocalFirstCandidate,
  inventory: readonly LocalFirstInventoryItem[],
  asOf: string
): { availability: LocalFirstAvailability; ingredients: LocalFirstIngredientAvailability[] } {
  const currentInventory = inventory.filter((item) => item.expiresOn === undefined || item.expiresOn >= asOf);
  const ingredients = candidate.ingredients.map((ingredient): LocalFirstIngredientAvailability => {
    const name = ingredientName(ingredient);
    const quantityProvenance = candidate.quantityProvenance;
    const requirement = normalizeRecipeIngredient(ingredient);
    if (!requirement) {
      return {
        name,
        availability: 'unknown',
        ...(quantityProvenance ? { quantityProvenance } : {}),
        present: false,
        requiredQuantity: null,
        requiredUnit: 'unknown',
        availableQuantity: null,
        availableUnit: 'unknown',
        missingQuantity: null,
        remainingQuantity: null,
      };
    }

    const matching = currentInventory.filter((item) =>
      normalizeInventoryName(item.ingredient_name) === requirement.normalizedName
    );
    if (quantityProvenance !== undefined) {
      return {
        name,
        availability: 'unknown',
        quantityProvenance,
        present: matching.length > 0,
        requiredQuantity: requirement.requiredQuantity,
        requiredUnit: requirement.requiredUnit,
        availableQuantity: null,
        availableUnit: 'unknown',
        missingQuantity: null,
        remainingQuantity: null,
      };
    }
    if (matching.length === 0) {
      return {
        name,
        availability: 'unknown',
        ...(quantityProvenance ? { quantityProvenance } : {}),
        present: false,
        requiredQuantity: requirement.requiredQuantity,
        requiredUnit: requirement.requiredUnit,
        availableQuantity: null,
        availableUnit: 'unknown',
        missingQuantity: null,
        remainingQuantity: null,
      };
    }

    const compared = compareRecipeRequirementsToInventory([requirement], matching)[0];
    return {
      name,
      availability: compared?.status ?? 'unknown',
      ...(quantityProvenance ? { quantityProvenance } : {}),
      present: true,
      requiredQuantity: compared?.requiredQuantity ?? requirement.requiredQuantity,
      requiredUnit: compared?.requiredUnit ?? requirement.requiredUnit,
      availableQuantity:
        compared?.availableUnit !== 'unknown' ? compared?.availableQuantity ?? null : null,
      availableUnit: compared?.availableUnit ?? 'unknown',
      missingQuantity: compared?.missingQuantity ?? null,
      remainingQuantity: compared?.remainingQuantity ?? null,
    };
  });
  const statuses: ComparedRequirement['status'][] = ingredients.map(({ availability }) => availability);
  if (statuses.length === 0 || statuses.includes('unknown')) return { availability: 'unknown', ingredients };
  if (statuses.every((status) => status === 'sufficient')) return { availability: 'sufficient', ingredients };
  if (statuses.every((status) => status === 'missing')) return { availability: 'missing', ingredients };
  return { availability: 'partial', ingredients };
}

function rankCandidate(candidate: LocalFirstCandidate, input: LocalFirstInput, inputIndex: number): ScoredRecommendation | null {
  if (candidate.source === 'provider' && input.providerStatus === 'unavailable') return null;
  if (isAlreadyPlanned(candidate, input)) return null;
  const ingredients = candidate.ingredients.map(ingredientName);
  const ranked = rankOneSlotOptions([{
    title: candidate.title,
    slot: candidate.slot,
    ingredients,
    prepMinutes: candidate.prepMinutes,
    source: candidate.source,
  }], {
    asOf: input.asOf,
    slot: input.slot,
    maxPrepMinutes: input.maxPrepMinutes,
    allergies: [...input.allergies],
    hardAvoid: [...input.hardAvoid],
    dislikedIngredients: [...input.dislikedIngredients],
    recentTitles: [...input.recentTitles],
    inventory: input.inventory.map(({ ingredient_name, expiresOn }) => ({
      name: ingredient_name,
      ...(expiresOn ? { expiresOn } : {}),
    })),
  });
  if (ranked.options.length !== 1) return null;

  const availabilityResult = availabilityFor(candidate, input.inventory, input.asOf);
  const availability = availabilityResult.availability;
  const preferredCount = input.preferred.filter((name) =>
    containsRestrictedIngredientName(ingredients, [name])
  ).length;
  const dislikedCount = input.dislikedIngredients.filter((name) =>
    containsRestrictedIngredientName(ingredients, [name])
  ).length;
  const recentRepeat = input.recentTitles.some((title) => normalizedTitle(title) === normalizedTitle(candidate.title));
  const timeRank = candidate.prepMinutes === null ? 1 : candidate.prepMinutes <= input.maxPrepMinutes ? 0 : 2;
  const reason = [`availability-${availability}`];
  if (candidate.prepMinutes === null) reason.push('prep-time-unknown');
  else if (timeRank === 0) reason.push('prep-time-within-limit');
  else reason.push('prep-time-exceeds-limit');
  if (preferredCount > 0) reason.push('preferred-ingredient');
  if (dislikedCount > 0) reason.push('disliked-ingredient');
  if (recentRepeat) reason.push('recent-repeat');
  if (candidate.source === 'saved_plan' && !candidate.plannedDate) reason.push('plan-date-unknown');
  const recommendation: LocalFirstRecommendation = {
    ...candidate,
    availability,
    ingredientAvailability: availabilityResult.ingredients,
    provenance: candidate.source,
    reason,
    uncertainty: {
      inventory: availability === 'unknown',
      prepTime: candidate.prepMinutes === null,
      planDate: candidate.source === 'saved_plan' && !candidate.plannedDate,
    },
  };
  return {
    recommendation,
    availabilityRank: AVAILABILITY_RANK[availability],
    timeRank,
    preferredCount,
    dislikedCount,
    recentRepeat,
    sourceRank: SOURCE_RANK[candidate.source],
    inputIndex,
  };
}

export function recommendLocalFirst(rawInput: unknown): LocalFirstResult {
  if (!validInput(rawInput)) return { status: 'invalid', reason: 'invalid-input', recommendations: [] };
  const scored: ScoredRecommendation[] = [];
  rawInput.candidates.forEach((rawCandidate, inputIndex) => {
    const candidate = parseCandidate(rawCandidate, rawInput);
    if (!candidate) return;
    const ranked = rankCandidate(candidate, rawInput, inputIndex);
    if (ranked) scored.push(ranked);
  });
  scored.sort((a, b) =>
    a.availabilityRank - b.availabilityRank ||
    a.timeRank - b.timeRank ||
    b.preferredCount - a.preferredCount ||
    a.dislikedCount - b.dislikedCount ||
    Number(a.recentRepeat) - Number(b.recentRepeat) ||
    a.sourceRank - b.sourceRank ||
    a.inputIndex - b.inputIndex
  );
  return { status: 'ready', recommendations: scored.slice(0, 5).map(({ recommendation }) => recommendation) };
}
