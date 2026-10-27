import { normalizeInventoryName } from '@/lib/inventory/normalize-inventory';
import {
  canCompareUnits,
  convertQuantity,
  normalizeUnit,
  parseQuantity,
} from '@/lib/inventory/quantity-normalization';
import type { RecipeInventoryItemRow } from '@/lib/db/types';
import { parseMealConsumptionPayload } from './consumption';
import type { PersistedMealPlanProfileContext } from './profile-context';
import type { StructuredMeal, StructuredMealPlan, StructuredMealType } from './structured-plan';

export type AdaptiveEvidenceStatus = 'known' | 'unknown';

export interface AdaptiveEvidence {
  label: string;
  status: AdaptiveEvidenceStatus;
  detail: string;
}

export interface AdaptiveMetric {
  status: AdaptiveEvidenceStatus;
  before: number | null;
  after: number | null;
  delta: number | null;
  unit: string | null;
}

export interface AdaptivePlanChange {
  slotKey: string;
  previousMeal: string;
  proposedMeal: string;
  reason: string;
}

export interface AdaptivePlanProposal {
  plan: StructuredMealPlan;
  changes: AdaptivePlanChange[];
  lockedSlotKeys: string[];
  evidence: AdaptiveEvidence[];
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  metrics: {
    freshness: AdaptiveMetric;
    time: AdaptiveMetric;
    cost: AdaptiveMetric;
    coverage: AdaptiveMetric;
  };
  limitations: string[];
}

export interface BuildAdaptiveMealPlanProposalInput {
  plan: StructuredMealPlan;
  inventoryItems: RecipeInventoryItemRow[];
  profile: PersistedMealPlanProfileContext | null;
  consumptionPayload: unknown;
  now: Date;
}

const MEAL_TYPES: StructuredMealType[] = ['breakfast', 'lunch', 'dinner'];

function clonePlan(plan: StructuredMealPlan): StructuredMealPlan {
  return {
    ...plan,
    days: plan.days.map((day) => ({
      ...day,
      meals: day.meals.map((meal) => ({
        ...meal,
        ingredients: meal.ingredients.map((ingredient) => ({ ...ingredient })),
      })),
    })),
    schedule: plan.schedule
      ? {
          ...plan.schedule,
          portionConfirmation: plan.schedule.portionConfirmation
            ? { ...plan.schedule.portionConfirmation }
            : undefined,
        }
      : undefined,
  };
}

function slotKey(dayIndex: number, mealType: StructuredMealType): string {
  return `${dayIndex}:${mealType}`;
}

function mealFingerprint(meal: StructuredMeal): string {
  return JSON.stringify(meal);
}

function validDate(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const parsed = new Date(`${trimmed}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== trimmed
      ? null
      : trimmed;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function daysUntil(expiration: string, now: Date): number | null {
  const today = new Date(now);
  if (Number.isNaN(today.getTime())) return null;
  const current = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const expiry = Date.parse(`${expiration}T00:00:00.000Z`);
  if (Number.isNaN(expiry)) return null;
  return Math.round((expiry - current) / 86_400_000);
}

function inventoryQuantity(item: RecipeInventoryItemRow) {
  return parseQuantity([item.quantity ?? '', item.unit ?? ''].filter(Boolean).join(' ').trim());
}

function comparableInventoryForIngredient(
  ingredient: StructuredMeal['ingredients'][number],
  inventoryItems: RecipeInventoryItemRow[]
): { expiration: string | null; known: boolean } {
  const requiredUnit = normalizeUnit(ingredient.unit);
  if (ingredient.quantity === null || requiredUnit === 'unknown') {
    return { expiration: null, known: false };
  }
  const matches = inventoryItems.filter(
    (item) =>
      (item.normalized_name?.trim() || normalizeInventoryName(item.ingredient_name)) ===
      normalizeInventoryName(ingredient.name)
  );
  if (matches.length === 0) return { expiration: null, known: true };

  let earliest: string | null = null;
  let hasUnknown = false;
  for (const item of matches) {
    const parsed = inventoryQuantity(item);
    if (
      !parsed.structured ||
      parsed.value === null ||
      parsed.value <= 0 ||
      parsed.unit === 'unknown' ||
      !canCompareUnits(parsed.unit, requiredUnit) ||
      convertQuantity(parsed.value, parsed.unit, requiredUnit) === null
    ) {
      hasUnknown = true;
      continue;
    }
    const expiration = validDate(item.expiration_date);
    if (!expiration) {
      hasUnknown = true;
      continue;
    }
    if (!earliest || expiration < earliest) earliest = expiration;
  }
  return { expiration: earliest, known: !hasUnknown };
}

function mealFreshnessScore(
  meal: StructuredMeal,
  inventoryItems: RecipeInventoryItemRow[],
  now: Date
): { score: number; known: boolean; urgent: boolean } {
  let score = 0;
  let known = true;
  let urgent = false;
  for (const ingredient of meal.ingredients) {
    const match = comparableInventoryForIngredient(ingredient, inventoryItems);
    if (!match.known) known = false;
    if (!match.known) continue;
    if (!match.expiration) continue;
    const remaining = daysUntil(match.expiration, now);
    if (remaining === null) {
      known = false;
      continue;
    }
    if (remaining < 0) continue;
    if (remaining <= 3) {
      urgent = true;
      score += 4 - remaining;
    }
  }
  return { score, known, urgent };
}

function metric(status: AdaptiveEvidenceStatus, unit: string | null = null): AdaptiveMetric {
  return { status, before: null, after: null, delta: null, unit };
}

function sortMovableMeals(
  entries: Array<{ meal: StructuredMeal; score: number; urgent: boolean; index: number }>
) {
  return [...entries].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.index - right.index;
  });
}

export function buildAdaptiveMealPlanProposal({
  plan,
  inventoryItems,
  profile,
  consumptionPayload,
  now,
}: BuildAdaptiveMealPlanProposalInput): AdaptivePlanProposal {
  const proposed = clonePlan(plan);
  const consumption = parseMealConsumptionPayload(consumptionPayload);
  const lockedSlotKeys = Object.keys(consumption).filter((key) => {
    const [dayIndex, mealType] = key.split(':');
    return Boolean(
      proposed.days.some(
        (day) =>
          day.dayIndex === Number(dayIndex) && MEAL_TYPES.includes(mealType as StructuredMealType)
      )
    );
  });
  const changes: AdaptivePlanChange[] = [];
  let knownFreshness = false;
  let unknownFreshness = false;
  let urgentMeals = 0;

  for (const mealType of MEAL_TYPES) {
    const movable: Array<{ meal: StructuredMeal; score: number; urgent: boolean; index: number }> =
      [];
    const targetSlots: Array<{ dayIndex: number; mealIndex: number }> = [];
    for (const day of proposed.days) {
      const mealIndex = day.meals.findIndex((meal) => meal.mealType === mealType);
      if (mealIndex < 0) continue;
      const key = slotKey(day.dayIndex, mealType);
      if (lockedSlotKeys.includes(key)) continue;
      const currentMeal = day.meals[mealIndex];
      const freshness = mealFreshnessScore(currentMeal, inventoryItems, now);
      if (freshness.known && freshness.score > 0) knownFreshness = true;
      else unknownFreshness = true;
      if (freshness.urgent) urgentMeals += 1;
      movable.push({
        meal: currentMeal,
        score: freshness.score,
        urgent: freshness.urgent,
        index: day.dayIndex,
      });
      targetSlots.push({ dayIndex: day.dayIndex, mealIndex });
    }
    const sorted = sortMovableMeals(movable);
    targetSlots.forEach(({ dayIndex, mealIndex }, index) => {
      const day = proposed.days.find((entry) => entry.dayIndex === dayIndex);
      const nextMeal = sorted[index]?.meal;
      if (!day || !nextMeal) return;
      const previousMeal = day.meals[mealIndex];
      day.meals[mealIndex] = nextMeal;
      if (previousMeal && previousMeal.title !== nextMeal.title) {
        changes.push({
          slotKey: slotKey(dayIndex, mealType),
          previousMeal: previousMeal.title,
          proposedMeal: nextMeal.title,
          reason: 'Prioriza evidencia de vencimiento próxima en inventario.',
        });
      }
    });
  }

  const evidence: AdaptiveEvidence[] = [];
  if (knownFreshness && urgentMeals > 0) {
    evidence.push({
      label: 'Vencimientos',
      status: 'known',
      detail: `${urgentMeals} comida(s) usan inventario cuantificado con vencimiento próximo.`,
    });
  } else {
    evidence.push({
      label: 'Vencimientos',
      status: unknownFreshness ? 'unknown' : 'known',
      detail: unknownFreshness
        ? 'No se pudo comparar todo el inventario por cantidades, unidades o fechas desconocidas.'
        : 'No hay evidencia de vencimiento próximo para reordenar.',
    });
  }
  const timeKnown =
    profile?.availableTimeMinutes !== undefined &&
    proposed.days.every((day) =>
      day.meals.every((meal) => meal.prepMinutes !== null && meal.prepMinutes !== undefined)
    );
  evidence.push({
    label: 'Tiempo disponible',
    status: timeKnown ? 'known' : 'unknown',
    detail: timeKnown
      ? `Perfil autenticado: ${profile!.availableTimeMinutes} minutos disponibles.`
      : 'No se afirma una mejora de tiempo porque falta perfil o una estimación completa.',
  });

  const priceKnown =
    inventoryItems.length > 0 &&
    inventoryItems.every(
      (item) => item.estimated_unit_price !== null && Number.isFinite(item.estimated_unit_price)
    );
  evidence.push({
    label: 'Presupuesto',
    status: priceKnown ? 'known' : 'unknown',
    detail: priceKnown
      ? 'Hay precios estimados persistidos; la reordenación no altera el costo total del plan.'
      : 'No se muestra ahorro porque faltan precios comparables persistidos.',
  });
  evidence.push({
    label: 'Cobertura',
    status: 'unknown',
    detail: 'La propuesta reordena comidas existentes y no inventa cobertura ni cantidades.',
  });

  const confidence =
    changes.length === 0 && !knownFreshness
      ? 'unknown'
      : knownFreshness && changes.length > 0
        ? 'high'
        : knownFreshness
          ? 'medium'
          : 'low';

  return {
    plan: proposed,
    changes,
    lockedSlotKeys,
    evidence,
    confidence,
    metrics: {
      freshness: {
        status: knownFreshness ? 'known' : 'unknown',
        before: null,
        after: null,
        delta: null,
        unit: null,
      },
      time: metric(timeKnown ? 'known' : 'unknown', 'min'),
      cost: metric(priceKnown ? 'known' : 'unknown', 'moneda local'),
      coverage: metric('unknown', null),
    },
    limitations: [
      'La propuesta solo reordena comidas ya persistidas; no crea recetas ni modifica cantidades.',
      'Las comidas cocinadas quedan bloqueadas y no se usa su inventario como consumo estimado.',
      'La confirmación requiere que el plan no haya cambiado desde la propuesta.',
    ],
  };
}

export function structuredMealPlanFingerprint(plan: StructuredMealPlan): string {
  return JSON.stringify(plan);
}

export function validateAdaptivePlanReplacement(
  source: StructuredMealPlan,
  proposed: StructuredMealPlan,
  consumptionPayload: unknown
): { valid: true } | { valid: false; reason: string } {
  if (source.period !== proposed.period || source.dayCount !== proposed.dayCount) {
    return { valid: false, reason: 'period_or_day_count_changed' };
  }
  if (JSON.stringify(source.schedule ?? null) !== JSON.stringify(proposed.schedule ?? null)) {
    return { valid: false, reason: 'schedule_changed' };
  }
  if (source.availableTimeMinutesSnapshot !== proposed.availableTimeMinutesSnapshot) {
    return { valid: false, reason: 'time_snapshot_changed' };
  }
  const sourceMeals = source.days.flatMap((day) => day.meals.map(mealFingerprint)).sort();
  const proposedMeals = proposed.days.flatMap((day) => day.meals.map(mealFingerprint)).sort();
  if (JSON.stringify(sourceMeals) !== JSON.stringify(proposedMeals)) {
    return { valid: false, reason: 'meal_content_changed' };
  }
  const consumption = parseMealConsumptionPayload(consumptionPayload);
  for (const key of Object.keys(consumption)) {
    const [dayIndexRaw, mealType] = key.split(':');
    const dayIndex = Number(dayIndexRaw);
    const sourceMeal = source.days
      .find((day) => day.dayIndex === dayIndex)
      ?.meals.find((meal) => meal.mealType === mealType);
    const proposedMeal = proposed.days
      .find((day) => day.dayIndex === dayIndex)
      ?.meals.find((meal) => meal.mealType === mealType);
    if (
      !sourceMeal ||
      !proposedMeal ||
      mealFingerprint(sourceMeal) !== mealFingerprint(proposedMeal)
    ) {
      return { valid: false, reason: 'consumed_slot_changed' };
    }
  }
  return { valid: true };
}
