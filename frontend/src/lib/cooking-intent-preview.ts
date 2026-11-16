import type { RecipeInventoryItemRow, UserMealPlanRow, UserRecipeDetailDto, UserRecipeVersionRow } from '@/lib/db/types';
import { classifyWasteExpiration, type WasteExpiryStatus } from '@/lib/waste-prevention';
import { normalizeInventoryName } from '@/lib/inventory/normalize-inventory';
import { convertExactQuantity, parseExactStoredQuantity, type NormalizedUnit } from '@/lib/inventory/quantity-normalization';
import { addQuantity, subtractQuantity, compareQuantity, multiplyQuantity, rational, quantityNumber, zeroQuantity, type ExactQuantity } from '@/lib/inventory/exact-quantity';
import { assessLocalRecipeRestrictions } from '@/lib/recipes/structured-ingredients';
import { mealPlanRestrictionsChanged, type StructuredMeal } from '@/lib/meal-planner/structured-plan';

export type CookingIntentSource = 'saved_recipe' | 'confirmed_meal_slot';
export type CookingIntentStatus = 'ready' | 'partial' | 'unknown' | 'blocked';
export type CookingIntentEvidence = 'verified' | 'partial' | 'unknown';
export type CookingIntentAvailability = 'sufficient' | 'partial' | 'missing' | 'unknown';
export type CookingIntentExpiry = Exclude<WasteExpiryStatus, 'later'> | 'fresh';

export interface CookingIntentIngredient {
  name: string;
  requiredQuantity: number | null;
  requiredUnit: NormalizedUnit;
  availableQuantity: number | null;
  availableUnit: NormalizedUnit;
  missingQuantity: number | null;
  remainingQuantity: number | null;
  availability: CookingIntentAvailability;
  expiry: CookingIntentExpiry;
  expiryDate: string | null;
  lotIds: string[];
  evidence: CookingIntentEvidence;
}

export interface CookingIntentStep {
  index: number;
  title: string;
  instruction: string;
}

export interface CookingIntentPreview {
  status: CookingIntentStatus;
  source: CookingIntentSource;
  title: string;
  recipeVersion: { recipeId: string; versionId: string };
  mealSlot?: { mealPlanId: string; dayIndex: number; mealType: StructuredMeal['mealType'] };
  portions: {
    original: number | null;
    requested: number | null;
    source: 'recipe' | 'plan' | 'unknown';
  };
  steps: CookingIntentStep[];
  ingredients: CookingIntentIngredient[];
  restrictions: { status: 'clear' | 'blocked' | 'unknown'; reasons: string[] };
  limitations: string[];
}

export interface CookingIntentMealSlot {
  mealPlan: UserMealPlanRow;
  meal: StructuredMeal;
  linkedVersion?: UserRecipeVersionRow;
  dayIndex: number;
  timeZone: string;
}

export interface BuildCookingIntentPreviewInput {
  source: CookingIntentSource;
  recipe?: UserRecipeDetailDto;
  mealSlot?: CookingIntentMealSlot;
  inventoryItems: RecipeInventoryItemRow[];
  allergies: readonly string[];
  hardAvoid: readonly string[];
  profileConfigured: boolean;
  now: Date;
  timeZone: string;
  requestedPortions: number | null;
}

type Requirement = {
  name: string;
  normalizedName: string;
  quantity: ExactQuantity | null;
  unit: NormalizedUnit;
};

const MAX_PORTIONS = 100;

function parseRecipeAmount(
  quantity: string | number | null | undefined,
  unit: string | null | undefined
): { value: ExactQuantity | null; unit: NormalizedUnit } {
  const parsed = parseExactStoredQuantity({ quantity: quantity == null ? null : String(quantity), unit: unit ?? null });
  return parsed && parsed.quantity.numerator > BigInt(0) &&
    Number.isFinite(quantityNumber(parsed.quantity)) && quantityNumber(parsed.quantity) > 0
    ? { value: parsed.quantity, unit: parsed.unit }
    : { value: null, unit: 'unknown' };
}

function requirementFromIngredient(ingredient: {
  name: string;
  quantity?: string | number | null;
  unit?: string | null;
}): Requirement {
  const amount = parseRecipeAmount(ingredient.quantity, ingredient.unit);
  return {
    name: ingredient.name.trim(),
    normalizedName: normalizeInventoryName(ingredient.name),
    quantity: amount.value,
    unit: amount.unit,
  };
}

function consolidateRequirements(requirements: Requirement[]): Requirement[] {
  const result = new Map<string, Requirement>();
  for (const requirement of requirements) {
    const current = result.get(requirement.normalizedName);
    if (!current) {
      result.set(requirement.normalizedName, { ...requirement });
      continue;
    }
    if (
      current.quantity === null ||
      requirement.quantity === null ||
      current.unit === 'unknown' ||
      requirement.unit === 'unknown'
    ) {
      current.quantity = null;
      current.unit = 'unknown';
      continue;
    }
    const converted = convertExactQuantity(requirement.quantity, requirement.unit, current.unit);
    current.quantity = converted === null ? null : addQuantity(current.quantity, converted);
    if (converted === null) current.unit = 'unknown';
  }
  return [...result.values()];
}

function scaleRequirements(
  requirements: Requirement[],
  originalPortions: number | null,
  requestedPortions: number | null,
  limitations: string[]
): Requirement[] {
  if (requestedPortions === null || originalPortions === null) {
    if (requestedPortions !== null && originalPortions === null) {
      limitations.push('portions_cannot_be_scaled_without_original_servings');
      return requirements.map((requirement) => ({ ...requirement, quantity: null, unit: 'unknown' }));
    }
    return requirements;
  }
  if (!Number.isSafeInteger(originalPortions) || !Number.isSafeInteger(requestedPortions) || originalPortions <= 0 || requestedPortions <= 0 || requestedPortions > MAX_PORTIONS) {
    limitations.push('invalid_portion_basis');
    return requirements.map((requirement) => ({ ...requirement, quantity: null, unit: 'unknown' }));
  }
  const factor = rational(BigInt(requestedPortions), BigInt(originalPortions));
  return requirements.map((requirement) => ({
    ...requirement,
    quantity: requirement.quantity === null ? null : multiplyQuantity(requirement.quantity, factor),
  }));
}

function parseSteps(instructions: string): CookingIntentStep[] {
  const lines = instructions
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
  return lines.map((instruction, index) => ({
    index: index + 1,
    title: `Paso ${index + 1}`,
    instruction,
  }));
}

function expiryRank(status: WasteExpiryStatus): number {
  return { expired: 0, due_today: 1, due_soon: 2, later: 3, unknown: 4 }[status];
}

function toPreviewExpiry(status: WasteExpiryStatus): CookingIntentExpiry {
  return status === 'later' ? 'fresh' : status;
}

function buildIngredientEvidence(
  requirement: Requirement,
  inventoryItems: RecipeInventoryItemRow[],
  now: Date,
  timeZone: string
): CookingIntentIngredient {
  const matches = inventoryItems.filter(
    (item) => normalizeInventoryName(item.ingredient_name) === requirement.normalizedName
  );
  const assessments = matches.map((item) => ({
    item,
    expiry: classifyWasteExpiration(item.expiration_date, now, timeZone),
  }));
  const knownExpiry = assessments.filter(({ expiry }) => expiry.status !== 'unknown');
  const usable = assessments.filter(
    ({ expiry }) =>
      expiry.status === 'due_today' || expiry.status === 'due_soon' || expiry.status === 'later'
  );
  const usableWithQuantity = usable.map(({ item, expiry }) => ({
    item,
    expiry,
    parsed: parseExactStoredQuantity(item),
  }));
  const lotIds = usable.map(({ item }) => item.id);
  const earliest = [...knownExpiry].sort(
    (a, b) => expiryRank(a.expiry.status) - expiryRank(b.expiry.status)
  )[0];
  const expiry = toPreviewExpiry(earliest?.expiry.status ?? 'unknown');
  const expiryDate =
    [...knownExpiry]
      .map(({ expiry: assessment }) => assessment.calendarDate)
      .filter((value): value is string => value !== null)
      .sort()[0] ?? null;

  const required = requirement.quantity;
  const requiredQuantity = required === null ? null : quantityNumber(required);
  const unknown = (): CookingIntentIngredient => ({
    name: requirement.name,
    requiredQuantity: requiredQuantity !== null && Number.isFinite(requiredQuantity) && requiredQuantity > 0 ? requiredQuantity : null,
    requiredUnit: requirement.unit,
    availableQuantity: null,
    availableUnit: requirement.unit,
    missingQuantity: null,
    remainingQuantity: null,
    availability: 'unknown',
    expiry, expiryDate, lotIds,
    evidence: 'unknown',
  });
  if (required === null || requiredQuantity === null || !Number.isFinite(requiredQuantity) ||
      requiredQuantity <= 0 || requirement.unit === 'unknown') return unknown();
  if (assessments.some(({ expiry: itemExpiry }) => itemExpiry.status === 'unknown')) return unknown();
  let available = zeroQuantity;
  for (const { parsed } of usableWithQuantity) {
    const converted = parsed && convertExactQuantity(parsed.quantity, parsed.unit, requirement.unit);
    if (!converted || converted.numerator < BigInt(0)) return unknown();
    available = addQuantity(available, converted);
  }
  const difference = subtractQuantity(available, required);
  const sufficient = compareQuantity(difference, zeroQuantity) >= 0;
  const availableQuantity = quantityNumber(available);
  const missingQuantity = sufficient ? 0 : quantityNumber(subtractQuantity(zeroQuantity, difference));
  const remainingQuantity = sufficient ? quantityNumber(difference) : 0;
  if (![availableQuantity, missingQuantity, remainingQuantity].every(Number.isFinite)) return unknown();
  return {
    name: requirement.name,
    requiredQuantity,
    requiredUnit: requirement.unit,
    availableQuantity,
    availableUnit: requirement.unit,
    missingQuantity,
    remainingQuantity,
    availability: sufficient ? 'sufficient' : available.numerator > BigInt(0) ? 'partial' : 'missing',
    expiry, expiryDate, lotIds,
    evidence: 'verified',
  };
}

export function buildCookingIntentPreview(
  input: BuildCookingIntentPreviewInput
): CookingIntentPreview {
  const limitations: string[] = [];
  const isRecipe = input.source === 'saved_recipe';
  const slot = input.mealSlot;
  const linked = !isRecipe && slot?.meal.recipeRef;
  const version = isRecipe ? input.recipe?.current_version : linked &&
    slot?.linkedVersion?.id === linked.versionId && slot.linkedVersion.recipe_id === linked.recipeId
    ? slot.linkedVersion : undefined;
  const title = version?.title ?? (linked || isRecipe ? '' : slot?.meal.title ?? '');
  const recipeId = version?.recipe_id ?? (linked || isRecipe ? '' : slot?.mealPlan.id ?? '');
  const versionId = version?.id ?? (linked || isRecipe ? '' : 'meal-slot:' + (slot?.dayIndex ?? '') + ':' + (slot?.meal.mealType ?? ''));
  const ingredients = version?.ingredients ?? (linked || isRecipe ? [] : slot?.meal.ingredients ?? []);
  const originalPortions = version?.servings ?? (linked || isRecipe ? null : slot?.mealPlan.people_count ?? null);
  const requestedPortions = input.requestedPortions ?? (!isRecipe ? slot?.mealPlan.people_count ?? null : null);
  const portionSource = version ? 'recipe' : 'plan';
  const requirements = scaleRequirements(
    consolidateRequirements(ingredients.map(requirementFromIngredient)),
    originalPortions,
    requestedPortions,
    limitations
  );
  const ingredientEvidence = requirements.map((requirement) =>
    buildIngredientEvidence(requirement, input.inventoryItems, input.now, input.timeZone)
  );
  const restrictionAssessment = assessLocalRecipeRestrictions(
    ingredients.map((ingredient) => ingredient.name),
    [title, version?.instructions ?? (!linked && !isRecipe ? slot?.meal.description ?? '' : '')],
    input.allergies,
    [...input.hardAvoid, ...(!isRecipe ? input.mealSlot?.mealPlan.restrictions ?? [] : [])]
  );
  const stale = !isRecipe && slot && mealPlanRestrictionsChanged(slot.mealPlan, [...input.allergies, ...input.hardAvoid]);
  const restrictions = restrictionAssessment.status === 'conflict'
    ? { status: 'blocked' as const, reasons: ['ingredient_restriction_conflict'] }
    : !input.profileConfigured
      ? { status: 'unknown' as const, reasons: ['culinary_profile_unavailable'] }
      : stale
        ? { status: 'unknown' as const, reasons: ['meal_plan_restrictions_changed'] }
      : restrictionAssessment.status === 'review'
        ? { status: 'unknown' as const, reasons: ['ingredient_restriction_requires_review'] }
        : { status: 'clear' as const, reasons: [] };

  if (!title || requirements.length === 0) limitations.push('ingredients_or_title_unavailable');
  if (input.source === 'saved_recipe' && input.recipe?.archived_at)
    limitations.push('recipe_archived');
  if (input.source === 'confirmed_meal_slot' && !input.mealSlot)
    limitations.push('meal_slot_unavailable');
  if (
    !isRecipe && !linked &&
    input.mealSlot?.meal.ingredients.some(
      (ingredient) => ingredient.quantity === null || !ingredient.unit
    )
  ) {
    limitations.push('meal_ingredient_quantity_or_unit_unknown');
  }

  const hasUnknownEvidence = ingredientEvidence.some(
    (item) => item.availability === 'unknown' || item.evidence !== 'verified'
  );
  const hasPartialCoverage = ingredientEvidence.some(
    (item) => item.availability === 'partial' || item.availability === 'missing'
  );
  const status: CookingIntentStatus =
    restrictions.status === 'blocked'
      ? 'blocked'
      : restrictions.status === 'unknown' || limitations.length > 0 || hasUnknownEvidence
        ? 'unknown'
        : hasPartialCoverage
          ? 'partial'
          : 'ready';

  return {
    status,
    source: input.source,
    title,
    recipeVersion: { recipeId, versionId },
    ...(!isRecipe && slot ? { mealSlot: { mealPlanId: slot.mealPlan.id, dayIndex: slot.dayIndex, mealType: slot.meal.mealType } } : {}),
    portions: {
      original: originalPortions,
      requested: requestedPortions ?? originalPortions,
      source: originalPortions === null ? 'unknown' : portionSource,
    },
    steps: version ? parseSteps(version.instructions) : [],
    ingredients: ingredientEvidence,
    restrictions,
    limitations,
  };
}
