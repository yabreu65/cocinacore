import { normalizeExpirationDate } from '@/lib/meal-planner/expiration-date';
import type {
  RecipeAiHistoryRow,
  RecipeInventoryItemRow,
  UserCulinaryProfileRow,
  UserMealPlanRow,
} from '@/lib/db/types';
import type { UserCulinaryProfileTermWithLabel } from '@/lib/db/repositories/culinaryProfileRepository';
import { buildPersistedMealPlanProfileContext } from '@/lib/meal-planner/profile-context';
import { parseMealConsumptionPayload, mealConsumptionKey } from '@/lib/meal-planner/consumption';
import { parseStructuredMealPlanValue, type StructuredMealType } from '@/lib/meal-planner/structured-plan';
import { containsRestrictedIngredientName } from '@/lib/recipes/structured-ingredients';
import type { TodayOptionSource, TodaySlot } from './one-slot';
import type { LocalFirstIngredient } from './local-first-engine';

const MAX_INVENTORY_ITEMS = 50;
const MAX_HISTORY_TITLES = 20;
const MAX_HISTORY_CANDIDATES = 5;
const MAX_SAVED_PLAN_CANDIDATES = 5;
const MAX_INGREDIENTS = 30;
const SLOT_VALUES = new Set<TodaySlot>(['breakfast', 'lunch', 'snack', 'dinner']);
const PLANNED_SLOT_VALUES = new Set<StructuredMealType>(['breakfast', 'lunch', 'dinner']);

export interface TodayProviderInventoryItem {
  name: string;
  quantity?: string;
  unit?: string;
  expiresOn?: string;
}

export interface TodayProviderContext {
  asOf: string;
  slot: TodaySlot;
  inventory: TodayProviderInventoryItem[];
  maxPrepMinutes?: number;
  allergies: string[];
  hardAvoid: string[];
  dislikedIngredients: string[];
  preferred: string[];
  goals: string[];
  profileConfigured: boolean;
  householdCounts?: { adult: number; teen: number; child: number };
}

export type TodayQuantityProvenance = 'ai_estimate' | 'unknown';

export interface TodayLocalCandidate {
  title: string;
  slot: TodaySlot;
  ingredients: LocalFirstIngredient[];
  prepMinutes: number | null;
  source: TodayOptionSource;
  quantityProvenance?: TodayQuantityProvenance;
}

export interface TodayLocalSignals {
  recentTitles: string[];
  historyCandidates: TodayLocalCandidate[];
  savedPlanCandidates: TodayLocalCandidate[];
}

export type TodayContextResult =
  | { status: 'ready'; providerContext: TodayProviderContext; localSignals: TodayLocalSignals }
  | { status: 'invalid'; reason: 'invalid-input' };

export interface BuildTodayContextInput {
  userId: string;
  tenantId: string;
  asOf: string;
  timeZone?: string;
  slot: TodaySlot;
  profile: UserCulinaryProfileRow | null;
  terms: readonly UserCulinaryProfileTermWithLabel[];
  inventory: readonly Pick<RecipeInventoryItemRow, 'tenant_id' | 'ingredient_name' | 'quantity' | 'unit' | 'expiration_date'>[];
  history: readonly Pick<RecipeAiHistoryRow, 'source' | 'recipe_title' | 'recipe_payload' | 'created_at'>[];
  latestPlan?: Pick<UserMealPlanRow, 'period' | 'calendar_payload' | 'consumption_payload'> | null;
  consumption?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.length > 0 && clean.length <= maxLength ? clean : null;
}

function boundedStrings(values: readonly string[] | undefined): string[] {
  return (values ?? []).map((value) => cleanString(value, 100)).filter((value): value is string => value !== null).slice(0, 20);
}

function buildInventory(
  rows: readonly Pick<RecipeInventoryItemRow, 'tenant_id' | 'ingredient_name' | 'quantity' | 'unit' | 'expiration_date'>[],
  tenantId: string,
  asOf: string,
  timeZone: string,
): TodayProviderInventoryItem[] {
  const output: TodayProviderInventoryItem[] = [];
  for (const row of rows) {
    if (row.tenant_id !== tenantId) continue;
    if (output.length >= MAX_INVENTORY_ITEMS) break;
    const name = cleanString(row.ingredient_name, 80);
    if (!name) continue;
    const expiresOn = row.expiration_date === null ? null : normalizeExpirationDate(row.expiration_date, timeZone);
    if (row.expiration_date !== null && (!expiresOn || expiresOn < asOf)) continue;
    const quantity = cleanString(row.quantity, 40);
    const unit = cleanString(row.unit, 24);
    output.push({
      name,
      ...(quantity ? { quantity } : {}),
      ...(unit ? { unit } : {}),
      ...(expiresOn ? { expiresOn } : {}),
    });
  }
  return output;
}

function parseHistoryCandidate(
  raw: unknown,
  defaultTitle: unknown,
  quantityProvenance: TodayQuantityProvenance,
): TodayLocalCandidate | null {
  if (!isRecord(raw)) return null;
  const slot = raw.slot;
  const title = cleanString(raw.title ?? defaultTitle, 120);
  const rawIngredients = raw.structuredIngredients;
  const prepMinutes = raw.prepMinutes;
  if (prepMinutes !== undefined && (typeof prepMinutes !== 'number' || !Number.isInteger(prepMinutes) || prepMinutes < 1 || prepMinutes > 240)) return null;
  if (!title || typeof slot !== 'string' || !SLOT_VALUES.has(slot as TodaySlot)) return null;
  if (!Array.isArray(rawIngredients) || rawIngredients.length < 1 || rawIngredients.length > MAX_INGREDIENTS) return null;
  const ingredients: LocalFirstIngredient[] = [];
  for (const item of rawIngredients) {
    if (!isRecord(item) || item.structured !== true || typeof item.normalized_name !== 'string') return null;
    const name = cleanString(item.name, 80);
    if (!name) return null;
    if (item.quantity !== null && (typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) || item.quantity < 0)) return null;
    if (item.unit !== null && typeof item.unit !== 'string') return null;
    ingredients.push({ name, quantity: item.quantity, unit: item.unit });
  }
  return {
    title,
    slot: slot as TodaySlot,
    ingredients,
    prepMinutes: prepMinutes ?? null,
    source: 'history',
    ...(ingredients.some((ingredient) => typeof ingredient !== 'string' && ingredient.quantity !== null && ingredient.quantity !== undefined)
      ? { quantityProvenance }
      : {}),
  };
}

function conflictsWithRestrictions(ingredients: readonly LocalFirstIngredient[], restrictions: readonly string[]): boolean {
  const names = ingredients.map((ingredient) => typeof ingredient === 'string' ? ingredient : ingredient.name);
  return names.length === 0 || containsRestrictedIngredientName(names, restrictions);
}

function savedPlanCandidates(input: BuildTodayContextInput, restrictions: readonly string[]): TodayLocalCandidate[] {
  const plan = input.latestPlan;
  if (!plan || !PLANNED_SLOT_VALUES.has(input.slot as StructuredMealType)) return [];
  const parsed = parseStructuredMealPlanValue(plan.calendar_payload, plan.period);
  if (!parsed.success) return [];
  const consumption = parseMealConsumptionPayload(input.consumption ?? plan.consumption_payload);
  const candidates: TodayLocalCandidate[] = [];
  for (const day of parsed.plan.days) {
    for (const meal of day.meals) {
      if (meal.mealType !== input.slot || consumption[mealConsumptionKey(day.dayIndex, meal.mealType)]) continue;
      const ingredients: LocalFirstIngredient[] = meal.ingredients.map(({ name, quantity, unit }) => ({ name, quantity, unit }));
      if (conflictsWithRestrictions(ingredients, restrictions)) continue;
      candidates.push({
        title: meal.title,
        slot: meal.mealType,
        ingredients,
        prepMinutes: null,
        source: 'saved_plan',
        ...(meal.ingredients.some(({ quantity }) => quantity !== null) ? { quantityProvenance: 'ai_estimate' } : {}),
      });
      if (candidates.length >= MAX_SAVED_PLAN_CANDIDATES) return candidates;
    }
  }
  return candidates;
}

export function buildTodayContext(input: BuildTodayContextInput): TodayContextResult {
  if (!input.userId || !input.tenantId || !isIsoDate(input.asOf) || !SLOT_VALUES.has(input.slot)) {
    return { status: 'invalid', reason: 'invalid-input' };
  }
  if (input.terms.some((term) => term.user_id !== input.userId)) {
    return { status: 'invalid', reason: 'invalid-input' };
  }
  if (!input.profile && input.terms.length > 0) return { status: 'invalid', reason: 'invalid-input' };
  const profile = input.profile
    ? buildPersistedMealPlanProfileContext(input.profile, input.terms, input.userId, input.tenantId)
    : { identity: [], preferred: [], avoid: [], goals: [] };
  if (!profile) return { status: 'invalid', reason: 'invalid-input' };

  const providerContext: TodayProviderContext = {
    asOf: input.asOf,
    slot: input.slot,
    inventory: buildInventory(input.inventory, input.tenantId, input.asOf, input.timeZone ?? 'UTC'),
    allergies: boundedStrings(profile.allergies),
    hardAvoid: boundedStrings(profile.avoid),
    dislikedIngredients: boundedStrings(profile.dislikedIngredients),
    preferred: boundedStrings(profile.preferred),
    goals: boundedStrings(profile.goals),
    profileConfigured: input.profile !== null,
    ...(profile.availableTimeMinutes === undefined ? {} : { maxPrepMinutes: profile.availableTimeMinutes }),
    ...(profile.householdCounts ? { householdCounts: { ...profile.householdCounts } } : {}),
  };

  const restrictions = [...providerContext.allergies, ...providerContext.hardAvoid];
  const recentTitles: string[] = [];
  const historyCandidates: TodayLocalCandidate[] = [];
  for (const row of input.history) {
    const title = cleanString(row.recipe_title, 120);
    if (title && recentTitles.length < MAX_HISTORY_TITLES && !recentTitles.includes(title)) recentTitles.push(title);
    if (historyCandidates.length >= MAX_HISTORY_CANDIDATES) continue;
    const candidate = parseHistoryCandidate(
      row.recipe_payload,
      row.recipe_title,
      row.source === 'gemini' ? 'ai_estimate' : 'unknown',
    );
    if (candidate?.slot === input.slot && !conflictsWithRestrictions(candidate.ingredients, restrictions)) historyCandidates.push(candidate);
  }

  return {
    status: 'ready',
    providerContext,
    localSignals: { recentTitles, historyCandidates, savedPlanCandidates: savedPlanCandidates(input, restrictions) },
  };
}
