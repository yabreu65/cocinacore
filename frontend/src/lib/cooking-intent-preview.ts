import type { RecipeInventoryItemRow, UserMealPlanRow, UserRecipeDetailDto } from '@/lib/db/types';
import { classifyWasteExpiration, type WasteExpiryStatus } from '@/lib/waste-prevention';
import { normalizeInventoryName } from '@/lib/inventory/normalize-inventory';
import {
  canCompareUnits,
  convertQuantity,
  normalizeUnit,
  parseQuantity,
  type NormalizedUnit,
} from '@/lib/inventory/quantity-normalization';
import { assessIngredientRestrictions } from '@/lib/recipes/structured-ingredients';
import type { StructuredMeal } from '@/lib/meal-planner/structured-plan';

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
  quantity: number | null;
  unit: NormalizedUnit;
};

const MAX_PORTIONS = 100;

function round(value: number): number {
  return Number(value.toFixed(4));
}

function parseRecipeAmount(
  quantity: string | number | null | undefined,
  unit: string | null | undefined
): { value: number | null; unit: NormalizedUnit } {
  const explicitUnit = normalizeUnit(unit ?? null);
  const quantityText = typeof quantity === 'number' ? String(quantity) : (quantity?.trim() ?? '');
  const parsed = parseQuantity([quantityText, unit ?? ''].filter(Boolean).join(' ').trim());

  // A bare number is not evidence of a count. It must carry a recognized unit.
  if (explicitUnit === 'unknown' || !parsed.structured || parsed.value === null) {
    return { value: null, unit: 'unknown' };
  }
  return { value: parsed.value, unit: explicitUnit };
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
      requirement.unit === 'unknown' ||
      !canCompareUnits(current.unit, requirement.unit)
    ) {
      current.quantity = null;
      current.unit = 'unknown';
      continue;
    }
    const converted = convertQuantity(requirement.quantity, requirement.unit, current.unit);
    current.quantity = converted === null ? null : round(current.quantity + converted);
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
    }
    return requirements;
  }
  if (originalPortions <= 0 || requestedPortions <= 0 || requestedPortions > MAX_PORTIONS) {
    limitations.push('invalid_portion_basis');
    return requirements.map((requirement) => ({ ...requirement, quantity: null, unit: 'unknown' }));
  }
  const factor = requestedPortions / originalPortions;
  return requirements.map((requirement) => ({
    ...requirement,
    quantity: requirement.quantity === null ? null : round(requirement.quantity * factor),
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
    parsed: parseQuantity([item.quantity ?? '', item.unit ?? ''].filter(Boolean).join(' ').trim()),
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

  if (matches.length === 0 || requirement.quantity === null || requirement.unit === 'unknown') {
    return {
      name: requirement.name,
      requiredQuantity: requirement.quantity,
      requiredUnit: requirement.unit,
      availableQuantity: null,
      availableUnit: requirement.unit,
      missingQuantity: null,
      remainingQuantity: null,
      availability: matches.length === 0 && requirement.quantity !== null ? 'missing' : 'unknown',
      expiry,
      expiryDate,
      lotIds,
      evidence: 'unknown',
    };
  }

  if (
    usableWithQuantity.length === 0 &&
    assessments.some(({ expiry: itemExpiry }) => itemExpiry.status === 'unknown')
  ) {
    return {
      name: requirement.name,
      requiredQuantity: requirement.quantity,
      requiredUnit: requirement.unit,
      availableQuantity: null,
      availableUnit: requirement.unit,
      missingQuantity: null,
      remainingQuantity: null,
      availability: 'unknown',
      expiry,
      expiryDate,
      lotIds,
      evidence: 'unknown',
    };
  }

  if (
    usableWithQuantity.some(
      ({ parsed }) => !parsed.structured || parsed.value === null || parsed.unit === 'unknown'
    )
  ) {
    return {
      name: requirement.name,
      requiredQuantity: requirement.quantity,
      requiredUnit: requirement.unit,
      availableQuantity: null,
      availableUnit: requirement.unit,
      missingQuantity: null,
      remainingQuantity: null,
      availability: 'unknown',
      expiry,
      expiryDate,
      lotIds,
      evidence: 'unknown',
    };
  }

  const requiredQuantity = requirement.quantity;
  let available = 0;
  for (const { parsed } of usableWithQuantity) {
    if (!canCompareUnits(parsed.unit, requirement.unit)) {
      return {
        name: requirement.name,
        requiredQuantity: requirement.quantity,
        requiredUnit: requirement.unit,
        availableQuantity: null,
        availableUnit: requirement.unit,
        missingQuantity: null,
        remainingQuantity: null,
        availability: 'unknown',
        expiry,
        expiryDate,
        lotIds,
        evidence: 'unknown',
      };
    }
    const converted =
      parsed.value === null ? null : convertQuantity(parsed.value, parsed.unit, requirement.unit);
    if (converted === null)
      return {
        name: requirement.name,
        requiredQuantity: requirement.quantity,
        requiredUnit: requirement.unit,
        availableQuantity: null,
        availableUnit: requirement.unit,
        missingQuantity: null,
        remainingQuantity: null,
        availability: 'unknown',
        expiry,
        expiryDate,
        lotIds,
        evidence: 'unknown',
      };
    available += converted;
  }

  const roundedAvailable = round(available);
  const difference = round(roundedAvailable - requiredQuantity);
  const availability: CookingIntentAvailability =
    difference >= 0 ? 'sufficient' : roundedAvailable > 0 ? 'partial' : 'missing';
  const evidence: CookingIntentEvidence = assessments.some(
    ({ expiry: itemExpiry }) => itemExpiry.status === 'unknown'
  )
    ? 'partial'
    : 'verified';
  return {
    name: requirement.name,
    requiredQuantity: requirement.quantity,
    requiredUnit: requirement.unit,
    availableQuantity: roundedAvailable,
    availableUnit: requirement.unit,
    missingQuantity: difference >= 0 ? 0 : round(Math.abs(difference)),
    remainingQuantity: difference >= 0 ? difference : 0,
    availability,
    expiry,
    expiryDate,
    lotIds,
    evidence,
  };
}

export function buildCookingIntentPreview(
  input: BuildCookingIntentPreviewInput
): CookingIntentPreview {
  const limitations: string[] = [];
  const isRecipe = input.source === 'saved_recipe';
  const title = isRecipe
    ? (input.recipe?.current_version.title ?? '')
    : (input.mealSlot?.meal.title ?? '');
  const recipeId = isRecipe ? (input.recipe?.id ?? '') : (input.mealSlot?.mealPlan.id ?? '');
  const versionId = isRecipe
    ? (input.recipe?.current_version.id ?? '')
    : `meal-slot:${input.mealSlot?.dayIndex ?? ''}:${input.mealSlot?.meal.mealType ?? ''}`;
  const ingredients = isRecipe
    ? (input.recipe?.current_version.ingredients ?? [])
    : (input.mealSlot?.meal.ingredients ?? []);
  const originalPortions = isRecipe
    ? (input.recipe?.current_version.servings ?? null)
    : (input.mealSlot?.mealPlan.people_count ?? null);
  const portionSource = isRecipe ? 'recipe' : 'plan';
  const requirements = scaleRequirements(
    consolidateRequirements(ingredients.map(requirementFromIngredient)),
    originalPortions,
    input.requestedPortions,
    limitations
  );
  const ingredientEvidence = requirements.map((requirement) =>
    buildIngredientEvidence(requirement, input.inventoryItems, input.now, input.timeZone)
  );
  const restrictionAssessment = assessIngredientRestrictions(
    ingredients.map((ingredient) => ingredient.name),
    [...input.allergies, ...input.hardAvoid]
  );
  const restrictions = !input.profileConfigured
    ? { status: 'unknown' as const, reasons: ['culinary_profile_unavailable'] }
    : restrictionAssessment.status === 'conflict'
      ? { status: 'blocked' as const, reasons: ['ingredient_restriction_conflict'] }
      : restrictionAssessment.status === 'review'
        ? { status: 'unknown' as const, reasons: ['ingredient_restriction_requires_review'] }
        : { status: 'clear' as const, reasons: [] };

  if (!title || requirements.length === 0) limitations.push('ingredients_or_title_unavailable');
  if (input.source === 'saved_recipe' && input.recipe?.archived_at)
    limitations.push('recipe_archived');
  if (input.source === 'confirmed_meal_slot' && !input.mealSlot)
    limitations.push('meal_slot_unavailable');
  if (
    !isRecipe &&
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
      : limitations.length > 0 || hasUnknownEvidence
        ? 'unknown'
        : hasPartialCoverage
          ? 'partial'
          : 'ready';

  return {
    status,
    source: input.source,
    title,
    recipeVersion: { recipeId, versionId },
    portions: {
      original: originalPortions,
      requested: input.requestedPortions ?? originalPortions,
      source: originalPortions === null ? 'unknown' : portionSource,
    },
    steps: isRecipe ? parseSteps(input.recipe?.current_version.instructions ?? '') : [],
    ingredients: ingredientEvidence,
    restrictions,
    limitations,
  };
}
