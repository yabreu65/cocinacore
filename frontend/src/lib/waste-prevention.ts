import { normalizeInventoryName } from './inventory/normalize-inventory';
import {
  canCompareUnits,
  convertQuantity,
  normalizeUnit,
  parseQuantity,
  type NormalizedUnit,
} from './inventory/quantity-normalization';
import { assessIngredientRestrictions } from './recipes/structured-ingredients';

export const DEFAULT_WASTE_PREVENTION_WINDOW_DAYS = 5;

export type WasteExpiryStatus = 'expired' | 'due_today' | 'due_soon' | 'later' | 'unknown';
export type WasteQuantityStatus = 'known' | 'unknown';
export type WasteRecipeCoverage = 'full' | 'partial' | 'unknown';
export type WasteRecipeIngredientStatus =
  | 'sufficient'
  | 'partial'
  | 'missing'
  | 'unknown'
  | 'expired';

export type WasteUnknownReason =
  | 'missing_expiration_date'
  | 'invalid_expiration_date'
  | 'invalid_now'
  | 'invalid_time_zone';

/** A tenant-scoped inventory row supplied by the route layer. */
export interface WastePreventionInventoryItemRow {
  id: string;
  ingredient_name: string;
  quantity: string | null;
  unit: string | null;
  expiration_date: string | null;
}

export interface WastePreventionRecipeIngredientRow {
  name: string;
  quantity?: string | number | null;
  unit?: string | null;
}

/** A user-owned persisted recipe row supplied by the route layer. */
export interface WastePreventionRecipeRow {
  id: string;
  title: string;
  ingredients: readonly WastePreventionRecipeIngredientRow[];
  archived_at?: string | null;
}

export interface WastePreventionInput {
  inventoryItems: readonly WastePreventionInventoryItemRow[];
  recipes: readonly WastePreventionRecipeRow[];
  culinaryProfileConfigured: boolean;
  allergies: readonly string[];
  hardAvoid: readonly string[];
  dislikedIngredients: readonly string[];
  now: string | Date;
  timeZone: string;
  windowDays: number;
}

export interface WasteExpiryAssessment {
  status: WasteExpiryStatus;
  calendarDate: string | null;
  daysRemaining: number | null;
  reason?: WasteUnknownReason;
}

export interface WasteInventoryLotAssessment extends WasteExpiryAssessment {
  lotId: string;
  ingredientName: string;
  normalizedName: string;
  expirationDate: string | null;
  quantity: string | null;
  unit: string | null;
  quantityStatus: WasteQuantityStatus;
  parsedQuantity: number | null;
  parsedUnit: NormalizedUnit;
}

export interface WasteRecipeIngredientEvidence {
  name: string;
  normalizedName: string;
  requiredQuantity: number | null;
  requiredUnit: NormalizedUnit;
  status: WasteRecipeIngredientStatus;
  availableQuantity: number | null;
  availableUnit: NormalizedUnit;
  matchedLotIds: string[];
  earliestUpcomingLotDate: string | null;
}

export interface WasteRecipeSuggestion {
  recipeId: string;
  title: string;
  coverage: WasteRecipeCoverage;
  matchedIngredientCount: number;
  requiredIngredientCount: number;
  expiringLotCount: number;
  dislikedIngredientCount: number;
  earliestUpcomingLotDate: string | null;
  ingredients: WasteRecipeIngredientEvidence[];
}

export interface WastePreventionReport {
  status: 'ready' | 'unknown';
  reason?: Exclude<WasteUnknownReason, 'missing_expiration_date' | 'invalid_expiration_date'>;
  asOfDate: string | null;
  timeZone: string;
  windowDays: number;
  lots: WasteInventoryLotAssessment[];
  suggestions: WasteRecipeSuggestion[];
}

// Compatibility aliases for callers that adopted the first U2 draft names.
export type BuildWastePreventionInput = WastePreventionInput;
export type WastePreventionInventoryLotInput = WastePreventionInventoryItemRow;
export type WastePreventionRecipeIngredientInput = WastePreventionRecipeIngredientRow;
export type WastePreventionRecipeInput = WastePreventionRecipeRow;

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP_PATTERN =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?)(Z|[+-]\d{2}(?::?\d{2})?)$/;

function isValidCalendarDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isValidIanaTimeZone(timeZone: string): boolean {
  if (!timeZone.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function normalizeOffset(offset: string): string | null {
  if (offset === 'Z') return offset;
  const match = /^([+-])(\d{2})(?::?(\d{2})?)$/.exec(offset);
  if (!match) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? '0');
  if (hours > 23 || minutes > 59) return null;
  return `${match[1]}${match[2]}:${String(minutes).padStart(2, '0')}`;
}

function parseTimestamp(value: string): Date | null {
  const match = TIMESTAMP_PATTERN.exec(value.trim());
  if (!match || !isValidCalendarDate(match[1])) return null;
  const offset = normalizeOffset(match[3]);
  if (!offset) return null;
  const date = new Date(`${match[1]}T${match[2]}${offset}`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function calendarDateInTimeZone(value: Date, timeZone: string): string | null {
  if (!Number.isFinite(value.getTime()) || !isValidIanaTimeZone(timeZone)) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get('year');
  const month = values.get('month');
  const day = values.get('day');
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function resolveCalendarDate(value: string | Date, timeZone: string): string | null {
  if (!isValidIanaTimeZone(timeZone)) return null;
  if (value instanceof Date) return calendarDateInTimeZone(value, timeZone);
  const trimmed = value.trim();
  if (isValidCalendarDate(trimmed)) return trimmed;
  const timestamp = parseTimestamp(trimmed);
  return timestamp ? calendarDateInTimeZone(timestamp, timeZone) : null;
}

function resolveExpirationCalendarDate(value: string, timeZone: string): string | null {
  const trimmed = value.trim();
  if (isValidCalendarDate(trimmed)) return trimmed;

  const match = TIMESTAMP_PATTERN.exec(trimmed);
  if (!match || !isValidCalendarDate(match[1])) return null;
  const offset = normalizeOffset(match[3]);
  if (!offset) return null;

  // Inventory dates are entered as YYYY-MM-DD and persisted in the legacy
  // timestamptz column as canonical UTC midnight. Preserve that calendar date
  // instead of shifting it into the browser timezone. Real timestamps keep
  // their instant semantics and are converted to the requested timezone.
  if ((offset === 'Z' || offset === '+00:00') && /^00:00(?::00(?:\.0+)?)?$/.test(match[2])) {
    return match[1];
  }

  const timestamp = parseTimestamp(trimmed);
  return timestamp ? calendarDateInTimeZone(timestamp, timeZone) : null;
}

function addCalendarDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function calendarDaysBetween(from: string, to: string): number {
  const fromMillis = Date.parse(`${from}T00:00:00.000Z`);
  const toMillis = Date.parse(`${to}T00:00:00.000Z`);
  return Math.round((toMillis - fromMillis) / 86400000);
}

function normalizeWindowDays(value: number): number {
  return Number.isInteger(value) && value >= 0 && value <= 30
    ? value
    : DEFAULT_WASTE_PREVENTION_WINDOW_DAYS;
}

export function classifyWasteExpiration(
  expirationDate: string | null,
  now: string | Date,
  timeZone: string,
  windowDays = DEFAULT_WASTE_PREVENTION_WINDOW_DAYS
): WasteExpiryAssessment {
  if (!isValidIanaTimeZone(timeZone)) {
    return {
      status: 'unknown',
      calendarDate: null,
      daysRemaining: null,
      reason: 'invalid_time_zone',
    };
  }
  const asOfDate = resolveCalendarDate(now, timeZone);
  if (!asOfDate)
    return { status: 'unknown', calendarDate: null, daysRemaining: null, reason: 'invalid_now' };
  if (expirationDate === null || expirationDate.trim() === '') {
    return {
      status: 'unknown',
      calendarDate: null,
      daysRemaining: null,
      reason: 'missing_expiration_date',
    };
  }

  const calendarDate = resolveExpirationCalendarDate(expirationDate, timeZone);
  if (!calendarDate) {
    return {
      status: 'unknown',
      calendarDate: null,
      daysRemaining: null,
      reason: 'invalid_expiration_date',
    };
  }

  const daysRemaining = calendarDaysBetween(asOfDate, calendarDate);
  if (daysRemaining < 0) return { status: 'expired', calendarDate, daysRemaining };
  if (daysRemaining === 0) return { status: 'due_today', calendarDate, daysRemaining };
  if (calendarDate <= addCalendarDays(asOfDate, normalizeWindowDays(windowDays))) {
    return { status: 'due_soon', calendarDate, daysRemaining };
  }
  return { status: 'later', calendarDate, daysRemaining };
}

function parseAmount(
  quantity: string | number | null | undefined,
  unit: string | null | undefined
): { value: number; unit: NormalizedUnit } | null {
  const quantityText = typeof quantity === 'number' ? String(quantity) : (quantity ?? '');
  const hasExplicitUnit = Boolean(unit?.trim()) || /\s+\S/.test(quantityText.trim());
  if (!hasExplicitUnit) return null;
  const raw = [quantityText, unit ?? ''].filter(Boolean).join(' ').trim();
  const parsed = parseQuantity(raw);
  if (
    !parsed.structured ||
    parsed.value === null ||
    !Number.isFinite(parsed.value) ||
    parsed.value < 0 ||
    parsed.unit === 'unknown'
  ) {
    return null;
  }
  return { value: parsed.value, unit: parsed.unit };
}

function compareDateValues(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left.localeCompare(right);
}

function sortLots(left: WasteInventoryLotAssessment, right: WasteInventoryLotAssessment): number {
  return (
    left.normalizedName.localeCompare(right.normalizedName) ||
    compareDateValues(left.calendarDate, right.calendarDate) ||
    left.lotId.localeCompare(right.lotId)
  );
}

function buildLotAssessments(
  input: WastePreventionInput,
  windowDays: number
): WasteInventoryLotAssessment[] {
  return input.inventoryItems
    .map((lot): WasteInventoryLotAssessment => {
      const expiry = classifyWasteExpiration(
        lot.expiration_date,
        input.now,
        input.timeZone,
        windowDays
      );
      const amount = parseAmount(lot.quantity, lot.unit);
      return {
        ...expiry,
        lotId: lot.id,
        ingredientName: lot.ingredient_name,
        normalizedName: normalizeInventoryName(lot.ingredient_name),
        expirationDate: lot.expiration_date,
        quantity: lot.quantity,
        unit: lot.unit,
        quantityStatus: amount ? 'known' : 'unknown',
        parsedQuantity: amount?.value ?? null,
        parsedUnit: amount?.unit ?? normalizeUnit(lot.unit),
      };
    })
    .sort(sortLots);
}

function recipeRequirement(ingredient: WastePreventionRecipeIngredientRow) {
  const amount = parseAmount(ingredient.quantity, ingredient.unit);
  return {
    name: ingredient.name,
    normalizedName: normalizeInventoryName(ingredient.name),
    requiredQuantity: amount?.value ?? null,
    requiredUnit: amount?.unit ?? 'unknown',
  };
}

function unknownIngredientEvidence(
  requirement: ReturnType<typeof recipeRequirement>,
  matchedLotIds: string[],
  earliestUpcomingLotDate: string | null
): WasteRecipeIngredientEvidence {
  return {
    name: requirement.name,
    normalizedName: requirement.normalizedName,
    requiredQuantity: requirement.requiredQuantity,
    requiredUnit: requirement.requiredUnit,
    status: 'unknown',
    availableQuantity: null,
    availableUnit: 'unknown',
    matchedLotIds,
    earliestUpcomingLotDate,
  };
}

function assessIngredientCoverage(
  requirement: ReturnType<typeof recipeRequirement>,
  lots: readonly WasteInventoryLotAssessment[]
): WasteRecipeIngredientEvidence {
  const matchingLots = lots.filter((lot) => lot.normalizedName === requirement.normalizedName);
  const expiredLots = matchingLots.filter((lot) => lot.status === 'expired');
  const activeLots = matchingLots.filter((lot) => lot.status !== 'expired');
  const matchedLotIds = activeLots.map((lot) => lot.lotId);
  const earliestUpcomingLotDate = activeLots.reduce<string | null>(
    (earliest, lot) =>
      lot.calendarDate && (earliest === null || lot.calendarDate < earliest)
        ? lot.calendarDate
        : earliest,
    null
  );

  if (activeLots.length === 0) {
    return {
      name: requirement.name,
      normalizedName: requirement.normalizedName,
      requiredQuantity: requirement.requiredQuantity,
      requiredUnit: requirement.requiredUnit,
      status: expiredLots.length > 0 ? 'expired' : 'missing',
      availableQuantity: null,
      availableUnit: requirement.requiredUnit,
      matchedLotIds: [],
      earliestUpcomingLotDate: null,
    };
  }

  if (
    requirement.requiredQuantity === null ||
    requirement.requiredUnit === 'unknown' ||
    activeLots.some((lot) => lot.quantityStatus === 'unknown' || lot.status === 'unknown')
  ) {
    return unknownIngredientEvidence(requirement, matchedLotIds, earliestUpcomingLotDate);
  }

  let availableQuantity = 0;
  for (const lot of activeLots) {
    if (lot.parsedQuantity === null || !canCompareUnits(lot.parsedUnit, requirement.requiredUnit)) {
      return unknownIngredientEvidence(requirement, matchedLotIds, earliestUpcomingLotDate);
    }
    const converted =
      lot.parsedUnit === requirement.requiredUnit
        ? lot.parsedQuantity
        : convertQuantity(lot.parsedQuantity, lot.parsedUnit, requirement.requiredUnit);
    if (converted === null) {
      return unknownIngredientEvidence(requirement, matchedLotIds, earliestUpcomingLotDate);
    }
    availableQuantity += converted;
  }

  const status: WasteRecipeIngredientStatus =
    availableQuantity >= requirement.requiredQuantity
      ? 'sufficient'
      : availableQuantity > 0
        ? 'partial'
        : 'missing';
  return {
    name: requirement.name,
    normalizedName: requirement.normalizedName,
    requiredQuantity: requirement.requiredQuantity,
    requiredUnit: requirement.requiredUnit,
    status,
    availableQuantity: Number(availableQuantity.toFixed(4)),
    availableUnit: requirement.requiredUnit,
    matchedLotIds,
    earliestUpcomingLotDate,
  };
}

function buildRecipeSuggestion(
  recipe: WastePreventionRecipeRow,
  lots: readonly WasteInventoryLotAssessment[],
  restrictions: readonly string[],
  dislikedIngredients: readonly string[]
): WasteRecipeSuggestion | null {
  if (recipe.archived_at || recipe.title.trim() === '' || recipe.ingredients.length === 0)
    return null;
  const requirements = recipe.ingredients.map(recipeRequirement);
  if (requirements.some((requirement) => !requirement.normalizedName)) return null;

  const restrictionAssessment = assessIngredientRestrictions(
    requirements.map((requirement) => requirement.name),
    restrictions
  );
  if (restrictionAssessment.status !== 'clear') return null;

  const ingredients = requirements.map((requirement) =>
    assessIngredientCoverage(requirement, lots)
  );
  if (ingredients.some((ingredient) => ingredient.status === 'expired')) return null;

  const matchedIngredientCount = ingredients.filter(
    (ingredient) => ingredient.matchedLotIds.length > 0
  ).length;
  if (matchedIngredientCount === 0) return null;

  const matchedLots = new Set(ingredients.flatMap((ingredient) => ingredient.matchedLotIds));
  const hasExpiringMatchedLot = lots.some(
    (lot) => matchedLots.has(lot.lotId) && (lot.status === 'due_today' || lot.status === 'due_soon')
  );
  if (!hasExpiringMatchedLot) return null;

  const coverage: WasteRecipeCoverage = ingredients.some(
    (ingredient) => ingredient.status === 'unknown'
  )
    ? 'unknown'
    : ingredients.every((ingredient) => ingredient.status === 'sufficient')
      ? 'full'
      : 'partial';
  const upcomingDates = ingredients
    .map((ingredient) => ingredient.earliestUpcomingLotDate)
    .filter((date): date is string => date !== null);
  const earliestUpcomingLotDate =
    upcomingDates.length > 0 ? ([...upcomingDates].sort()[0] ?? null) : null;
  const expiringLotCount = lots.filter(
    (lot) => matchedLots.has(lot.lotId) && (lot.status === 'due_today' || lot.status === 'due_soon')
  ).length;
  const dislikedIngredientCount = dislikedIngredients.filter(
    (disliked) =>
      assessIngredientRestrictions(
        requirements.map((requirement) => requirement.name),
        [disliked]
      ).status !== 'clear'
  ).length;

  return {
    recipeId: recipe.id,
    title: recipe.title,
    coverage,
    matchedIngredientCount,
    requiredIngredientCount: ingredients.length,
    expiringLotCount,
    dislikedIngredientCount,
    earliestUpcomingLotDate,
    ingredients,
  };
}

const COVERAGE_RANK: Record<WasteRecipeCoverage, number> = {
  full: 0,
  partial: 1,
  unknown: 2,
};

function sortSuggestions(left: WasteRecipeSuggestion, right: WasteRecipeSuggestion): number {
  return (
    compareDateValues(left.earliestUpcomingLotDate, right.earliestUpcomingLotDate) ||
    COVERAGE_RANK[left.coverage] - COVERAGE_RANK[right.coverage] ||
    right.expiringLotCount - left.expiringLotCount ||
    right.matchedIngredientCount - left.matchedIngredientCount ||
    left.dislikedIngredientCount - right.dislikedIngredientCount ||
    left.title.localeCompare(right.title) ||
    left.recipeId.localeCompare(right.recipeId)
  );
}

/**
 * Builds a read-only, route-ready waste-prevention projection.
 * The caller must provide tenant-scoped inventory and user-owned recipe rows.
 */
export function buildWastePreventionReport(input: WastePreventionInput): WastePreventionReport {
  const windowDays = normalizeWindowDays(input.windowDays);
  const validTimeZone = isValidIanaTimeZone(input.timeZone);
  const asOfDate = validTimeZone ? resolveCalendarDate(input.now, input.timeZone) : null;
  const lots = buildLotAssessments(input, windowDays);
  const reportStatus = validTimeZone && asOfDate ? 'ready' : 'unknown';
  const reportReason = !validTimeZone ? 'invalid_time_zone' : asOfDate ? undefined : 'invalid_now';

  if (reportStatus === 'unknown') {
    return {
      status: reportStatus,
      reason: reportReason,
      asOfDate,
      timeZone: input.timeZone,
      windowDays,
      lots,
      suggestions: [],
    };
  }

  const restrictions = [...input.allergies, ...input.hardAvoid];
  const suggestions = input.culinaryProfileConfigured
    ? input.recipes
        .map((recipe) =>
          buildRecipeSuggestion(recipe, lots, restrictions, input.dislikedIngredients)
        )
        .filter((suggestion): suggestion is WasteRecipeSuggestion => suggestion !== null)
        .sort(sortSuggestions)
    : [];

  return {
    status: reportStatus,
    asOfDate,
    timeZone: input.timeZone,
    windowDays,
    lots,
    suggestions,
  };
}
