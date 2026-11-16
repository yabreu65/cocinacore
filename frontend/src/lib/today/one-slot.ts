import { readHardRestrictionList } from '@/lib/profile/culinary-profile-contract';
import { assessLocalRecipeRestrictions, containsRestrictedIngredientName, normalizeIngredientName } from '../recipes/structured-ingredients';

export const TODAY_SLOT_VALUES = ['breakfast', 'lunch', 'snack', 'dinner'] as const;
export type TodaySlot = (typeof TODAY_SLOT_VALUES)[number];
export type TodayOptionSource = 'provider' | 'history' | 'saved_plan' | 'saved_recipe';

export interface TodayOption {
  title: string;
  slot: TodaySlot;
  ingredients?: string[];
  prepMinutes: number | null;
  source?: TodayOptionSource;
}

export interface TodaySlotContext {
  asOf: string;
  slot: TodaySlot;
  maxPrepMinutes: number;
  allergies: string[];
  hardAvoid: string[];
  dislikedIngredients: string[];
  recentTitles: string[];
  inventory: Array<{ name: string; expiresOn?: string }>;
}

export interface RankedTodayOption {
  title: string;
  slot: TodaySlot;
  ingredients: string[];
  prepMinutes: number | null;
  source: TodayOptionSource;
}

export type OneSlotResult =
  | { status: 'success'; options: RankedTodayOption[] }
  | { status: 'degraded'; reason: 'fewer-than-three-safe-options'; options: RankedTodayOption[] }
  | { status: 'invalid'; reason: 'invalid-context'; options: [] };

const SLOT_SET = new Set<TodaySlot>(TODAY_SLOT_VALUES);
const MAX_OPTIONS = 30;
export const MAX_TODAY_TITLE_LENGTH = 120;
const MAX_STRING_LENGTH = 80;
const MAX_INGREDIENTS = 30;
const MAX_RESTRICTIONS = 20;
const MAX_INVENTORY = 50;
const MAX_CONTEXT_PREP_MINUTES = 240;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function isSlot(value: unknown): value is TodaySlot {
  return typeof value === 'string' && SLOT_SET.has(value as TodaySlot);
}

function parseDate(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? parsed : null;
}

function parseStringArray(value: unknown, maxItems: number, maxLength = MAX_STRING_LENGTH): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  if (!value.every((item) => boundedString(item, maxLength))) return null;
  return value.map((item) => (item as string).trim());
}

function parseContext(value: unknown): TodaySlotContext | null {
  if (!isRecord(value) || parseDate(value.asOf) === null || !isSlot(value.slot)) return null;
  if (typeof value.maxPrepMinutes !== 'number' || !Number.isInteger(value.maxPrepMinutes) || value.maxPrepMinutes < 1 || value.maxPrepMinutes > MAX_CONTEXT_PREP_MINUTES) return null;

  const allergies = readHardRestrictionList(value.allergies);
  const hardAvoid = readHardRestrictionList(value.hardAvoid);
  const dislikedIngredients = parseStringArray(value.dislikedIngredients, MAX_RESTRICTIONS);
  const recentTitles = parseStringArray(value.recentTitles, MAX_RESTRICTIONS, MAX_TODAY_TITLE_LENGTH);
  if (!allergies || !hardAvoid || !dislikedIngredients || !recentTitles) return null;
  if (!Array.isArray(value.inventory) || value.inventory.length > MAX_INVENTORY) return null;

  const inventory: TodaySlotContext['inventory'] = [];
  for (const item of value.inventory) {
    if (!isRecord(item) || !boundedString(item.name, MAX_STRING_LENGTH)) return null;
    if (item.expiresOn !== undefined && parseDate(item.expiresOn) === null) return null;
    inventory.push({
      name: item.name.trim(),
      ...(typeof item.expiresOn === 'string' ? { expiresOn: item.expiresOn } : {}),
    });
  }

  return {
    asOf: value.asOf as string,
    slot: value.slot,
    maxPrepMinutes: value.maxPrepMinutes,
    allergies,
    hardAvoid,
    dislikedIngredients,
    recentTitles,
    inventory,
  };
}

function parseOption(value: unknown): RankedTodayOption | null {
  if (!isRecord(value) || !boundedString(value.title, MAX_TODAY_TITLE_LENGTH) || !isSlot(value.slot)) return null;
  if (!Object.prototype.hasOwnProperty.call(value, 'prepMinutes')) return null;
  if (value.prepMinutes !== null && (typeof value.prepMinutes !== 'number' || !Number.isInteger(value.prepMinutes) || value.prepMinutes < 1 || value.prepMinutes > 240)) return null;
  const validSources: TodayOptionSource[] = ['provider', 'history', 'saved_plan', 'saved_recipe'];
  if (value.source !== undefined && (typeof value.source !== 'string' || !validSources.includes(value.source as TodayOptionSource))) return null;
  if (value.prepMinutes === null && value.source !== 'history' && value.source !== 'saved_plan' && value.source !== 'saved_recipe') return null;
  const source = value.source === undefined ? 'provider' : value.source as TodayOptionSource;
  let ingredients: string[] = [];
  if (value.ingredients !== undefined) {
    const parsed = parseStringArray(value.ingredients, MAX_INGREDIENTS);
    if (!parsed || parsed.length === 0) return null;
    ingredients = parsed;
  }
  return {
    title: value.title.trim(),
    slot: value.slot,
    ingredients,
    prepMinutes: value.prepMinutes,
    source,
  };
}

interface ScoredOption {
  option: RankedTodayOption;
  expiringDays: number;
  inventoryMatches: number;
  timeClass: 0 | 1 | 2;
  dislikedCount: number;
  repeated: boolean;
  inputIndex: number;
}

/** Rank safe provider options deterministically; restrictions always beat preference scores. */
export function rankOneSlotOptions(rawOptions: unknown, rawContext: unknown): OneSlotResult {
  const context = parseContext(rawContext);
  if (!context || !Array.isArray(rawOptions) || rawOptions.length > MAX_OPTIONS) {
    return { status: 'invalid', reason: 'invalid-context', options: [] };
  }

  const restrictions = [...context.allergies, ...context.hardAvoid];
  const asOf = parseDate(context.asOf)!;
  const scored: ScoredOption[] = [];

  rawOptions.forEach((rawOption: unknown, inputIndex: number) => {
    const option = parseOption(rawOption);
    if (!option || option.slot !== context.slot) return;
    if (restrictions.length > 0 && option.ingredients.length === 0) return;
    if (option.source === 'provider'
      ? containsRestrictedIngredientName(option.ingredients, restrictions) || containsRestrictedIngredientName([option.title], restrictions)
      : assessLocalRecipeRestrictions(option.ingredients, [option.title], context.allergies, context.hardAvoid).status !== 'clear') return;

    const usableInventory = context.inventory.filter((item) => {
      const expiry = item.expiresOn === undefined ? null : parseDate(item.expiresOn);
      return expiry === null || expiry >= asOf;
    });
    const normalizedIngredients = new Set(option.ingredients.map(normalizeIngredientName));
    const matchedInventory = usableInventory.filter((item) =>
      normalizedIngredients.has(normalizeIngredientName(item.name))
    );
    const datedMatches = matchedInventory
      .map((item) => item.expiresOn === undefined ? null : parseDate(item.expiresOn))
      .filter((expiry): expiry is number => expiry !== null);

    scored.push({
      option,
      expiringDays: datedMatches.length > 0 ? Math.min(...datedMatches) - asOf : Number.POSITIVE_INFINITY,
      inventoryMatches: matchedInventory.length,
      timeClass: option.prepMinutes === null ? 1 : option.prepMinutes <= context.maxPrepMinutes ? 0 : 2,
      dislikedCount: context.dislikedIngredients.filter((name) =>
        containsRestrictedIngredientName(option.ingredients, [name])
      ).length,
      repeated: context.recentTitles.some((title) => title.toLocaleLowerCase() === option.title.toLocaleLowerCase()),
      inputIndex,
    });
  });

  scored.sort((a, b) =>
    a.timeClass - b.timeClass ||
    a.expiringDays - b.expiringDays ||
    b.inventoryMatches - a.inventoryMatches ||
    a.dislikedCount - b.dislikedCount ||
    Number(a.repeated) - Number(b.repeated) ||
    a.inputIndex - b.inputIndex
  );

  const options = scored.slice(0, 5).map(({ option }) => option);
  return options.length >= 3
    ? { status: 'success', options }
    : { status: 'degraded', reason: 'fewer-than-three-safe-options', options };
}
