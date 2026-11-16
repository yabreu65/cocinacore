import { readHardRestrictionList } from '@/lib/profile/culinary-profile-contract';
import { containsRestrictedIngredientName } from '@/lib/recipes/structured-ingredients';
import { z } from 'zod';
import { getMealPlanCanonicalDayLabel, getMealPlanDayCount, type MealPlanPeriod } from './prompt';

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner'] as const;

export type StructuredMealType = (typeof MEAL_TYPES)[number];

export interface StructuredMealPlanIngredient {
  name: string;
  quantity: number | null;
  unit: string | null;
}

export interface StructuredMeal {
  mealType: StructuredMealType;
  title: string;
  prepMinutes?: number | null;
  description: string | null;
  ingredients: StructuredMealPlanIngredient[];
  recipeRef?: {
    recipeId: string;
    versionId: string;
  };
}

/** Reject known conflicts in visible meal text as well as unresolved ingredient evidence. */
export function hasRestrictedMealContent(meal: StructuredMeal, restrictions: readonly string[]): boolean {
  return containsRestrictedIngredientName(meal.ingredients.map(({ name }) => name), restrictions) ||
    containsRestrictedIngredientName([meal.title, ...(meal.description ? [meal.description] : [])], restrictions);
}

export interface StructuredMealPlanDay {
  dayIndex: number;
  label: string;
  meals: StructuredMeal[];
}

export interface StructuredMealPlanSchedule {
  startDate: string;
  timeZone: string;
  confirmedAt: string;
  portionConfirmation?: {
    peopleCount: number;
    confirmedAt: string;
  };
}

export interface StructuredMealPlan {
  period: MealPlanPeriod;
  dayCount: number;
  availableTimeMinutesSnapshot?: number | null;
  days: StructuredMealPlanDay[];
  schedule?: StructuredMealPlanSchedule;
}

export function hasRestrictedMealPlanContent(plan: StructuredMealPlan, restrictions: readonly string[]): boolean {
  return plan.days.some((day) => day.meals.some((meal) => hasRestrictedMealContent(meal, restrictions)));
}

/** A new exclusion needs a fresh model proposal, not a local non-match.
 * The server stores this generation evidence in the existing private context JSON.
 */
export function mealPlanRestrictionsChanged(
  plan: { restrictions?: unknown; inventory_snapshot?: unknown },
  current: readonly string[]
): boolean {
  const explicit = readHardRestrictionList(plan.restrictions ?? []);
  const active = readHardRestrictionList(current);
  if (!explicit || !active) return true;
  const snapshot = plan.inventory_snapshot;
  const evidence = isRecord(snapshot) && Object.hasOwn(snapshot, 'evaluatedHardRestrictions')
    ? readHardRestrictionList(snapshot.evaluatedHardRestrictions)
    : explicit;
  return !evidence || [...explicit, ...active].some((restriction) => !evidence.includes(restriction));
}

export type StructuredMealPlanParseResult =
  | { success: true; plan: StructuredMealPlan }
  | { success: false; reason: string };

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function boundedRequiredText(maxLength: number) {
  return z.string().transform(normalizeWhitespace).pipe(z.string().min(1).max(maxLength));
}

const nullableBoundedText = (maxLength: number) =>
  z
    .string()
    .nullable()
    .optional()
    .transform((value) => (typeof value === 'string' ? normalizeWhitespace(value) || null : null))
    .pipe(z.string().max(maxLength).nullable());

const structuredMealPlanIngredientCandidateSchema = z
  .object({
    name: boundedRequiredText(120),
    quantity: z.number().finite().nonnegative().nullable(),
    unit: z
      .string()
      .nullable()
      .transform((value) => (typeof value === 'string' ? normalizeWhitespace(value) || null : null))
      .pipe(z.string().min(1).max(40).nullable()),
  })
  .strict();

const structuredMealCandidateSchema = z
  .object({
    mealType: z.enum(MEAL_TYPES),
    title: boundedRequiredText(160),
    prepMinutes: z.number().int().min(1).max(240),
    description: nullableBoundedText(300),
    ingredients: z.array(structuredMealPlanIngredientCandidateSchema).min(1).max(30),
    recipeRef: z
      .object({ recipeId: z.string().uuid(), versionId: z.string().uuid() })
      .strict()
      .optional(),
  })
  .strict();

const structuredMealPlanDayCandidateSchema = z
  .object({
    dayIndex: z.number().int().positive(),
    meals: z.array(structuredMealCandidateSchema).length(3),
  })
  .strict();

/** Bounded provider candidate schema; canonical labels are assigned server-side. */
export const structuredMealPlanCandidateSchema = z
  .object({
    period: z.enum(['week', 'fortnight', 'month']),
    dayCount: z.number().int().positive(),
    days: z.array(structuredMealPlanDayCandidateSchema).min(1).max(30),
  })
  .strict();

/** JSON Schema sent to Gemini so its output shape matches the server contract. */
export const structuredMealPlanResponseJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['period', 'dayCount', 'days'],
  properties: {
    period: { type: 'string', enum: ['week', 'fortnight', 'month'] },
    dayCount: { type: 'integer', minimum: 1, maximum: 30 },
    days: {
      type: 'array',
      minItems: 1,
      maxItems: 30,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['dayIndex', 'meals'],
        properties: {
          dayIndex: { type: 'integer', minimum: 1, maximum: 30 },
          meals: {
            type: 'array',
            minItems: 3,
            maxItems: 3,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['mealType', 'title', 'prepMinutes', 'description', 'ingredients'],
              properties: {
                mealType: { type: 'string', enum: [...MEAL_TYPES] },
                title: { type: 'string', minLength: 1, maxLength: 160 },
                prepMinutes: { type: 'integer', minimum: 1, maximum: 240 },
                description: { type: ['string', 'null'], maxLength: 300 },
                ingredients: {
                  type: 'array',
                  maxItems: 30,
                  minItems: 1,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['name', 'quantity', 'unit'],
                    properties: {
                      name: { type: 'string', minLength: 1, maxLength: 120 },
                      quantity: { type: ['number', 'null'], minimum: 0 },
                      unit: { type: ['string', 'null'], minLength: 1, maxLength: 40 },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

export function buildStructuredMealPlanInstructions(
  period: MealPlanPeriod,
  peopleCount: number,
  availableTimeMinutes: number | null = null
): string {
  const dayCount = getMealPlanDayCount(period);
  const capInstruction =
    availableTimeMinutes === null
      ? ''
      : `Cada comida individual debe estimarse en no más de ${availableTimeMinutes} minutos.`;

  return `Devuelve únicamente un objeto JSON válido, sin markdown ni texto adicional.
El JSON debe respetar exactamente el esquema de respuesta configurado.
Usa period como "${period}", dayCount ${dayCount}, y días con dayIndex consecutivos de 1 a ${dayCount}.
Cada día debe incluir exactamente un mealType breakfast, lunch y dinner.
Cada comida debe incluir prepMinutes como estimación entera de minutos entre 1 y 240; no es una garantía de duración real.
${capInstruction}
Las cantidades numéricas deben ser el total para las ${peopleCount} personas solicitadas, no una cantidad por persona.
Para cantidades desconocidas usa quantity: null y unit: null; no inventes cantidades.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isValidTimeZone(value: string): boolean {
  if (!value.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function getLocalDateInTimeZone(date: Date, timeZone: string): string | null {
  if (!Number.isFinite(date.getTime()) || !isValidTimeZone(timeZone)) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const partValues = new Map(parts.map((part) => [part.type, part.value]));
  const year = partValues.get('year');
  const month = partValues.get('month');
  const day = partValues.get('day');
  if (!year || !month || !day) return null;
  return `${year.padStart(4, '0')}-${month}-${day}`;
}

function isValidUtcTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

const structuredMealPlanScheduleSchema = z
  .object({
    startDate: z.string().refine(isValidIsoDate),
    timeZone: z.string().min(1).max(100).refine(isValidTimeZone),
    confirmedAt: z.string().refine(isValidUtcTimestamp),
    portionConfirmation: z
      .object({
        peopleCount: z.number().int().min(1).max(100),
        confirmedAt: z.string().refine(isValidUtcTimestamp),
      })
      .strict()
      .optional(),
  })
  .strict();

export function parseStructuredMealPlanSchedule(value: unknown): StructuredMealPlanSchedule | null {
  const parsed = structuredMealPlanScheduleSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function withoutPersistedDayLabel(day: unknown): unknown {
  if (!isRecord(day)) return day;

  const candidateDay: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(day)) {
    if (key !== 'label') candidateDay[key] = entry;
  }
  return candidateDay;
}

function parseStructuredMealPlanCandidate(
  candidate: unknown,
  requestedPeriod: MealPlanPeriod,
  historical = false
): StructuredMealPlanParseResult {
  const parsedCandidate =
    historical && isRecord(candidate) && isUnknownArray(candidate.days)
      ? {
          ...candidate,
          days: candidate.days.map((day) =>
            isRecord(day) && isUnknownArray(day.meals)
              ? {
                  ...day,
                  meals: day.meals.map((meal) =>
                    isRecord(meal) ? { prepMinutes: null, ...meal } : meal
                  ),
                }
              : day
          ),
        }
      : candidate;
  const historicalSchema = structuredMealPlanCandidateSchema.extend({
    days: z
      .array(
        structuredMealPlanDayCandidateSchema.extend({
          meals: z
            .array(
              structuredMealCandidateSchema.extend({
                prepMinutes: z.number().int().min(1).max(240).nullable(),
              })
            )
            .length(3),
        })
      )
      .min(1)
      .max(30),
  });
  const parsed = (historical ? historicalSchema : structuredMealPlanCandidateSchema).safeParse(
    parsedCandidate
  );
  if (!parsed.success) {
    return { success: false, reason: 'schema_invalid' };
  }

  const expectedDayCount = getMealPlanDayCount(requestedPeriod);
  if (parsed.data.period !== requestedPeriod) {
    return { success: false, reason: 'period_mismatch' };
  }
  if (parsed.data.dayCount !== expectedDayCount || parsed.data.days.length !== expectedDayCount) {
    return { success: false, reason: 'day_count_mismatch' };
  }

  const days: StructuredMealPlanDay[] = [];
  for (let index = 0; index < parsed.data.days.length; index += 1) {
    const day = parsed.data.days[index];
    const expectedDayIndex = index + 1;
    if (day.dayIndex !== expectedDayIndex) {
      return { success: false, reason: 'day_index_mismatch' };
    }

    const mealsByType = new Map(day.meals.map((meal) => [meal.mealType, meal]));
    if (
      mealsByType.size !== MEAL_TYPES.length ||
      MEAL_TYPES.some((type) => !mealsByType.has(type))
    ) {
      return { success: false, reason: 'meal_types_invalid' };
    }

    days.push({
      dayIndex: day.dayIndex,
      label: getMealPlanCanonicalDayLabel(requestedPeriod, day.dayIndex),
      meals: MEAL_TYPES.map((mealType) => {
        const meal = mealsByType.get(mealType)!;
        return meal.recipeRef ? { ...meal, recipeRef: meal.recipeRef } : meal;
      }),
    });
  }

  return {
    success: true,
    plan: {
      period: requestedPeriod,
      dayCount: expectedDayCount,
      days,
    },
  };
}

export function parseStructuredMealPlanResponse(
  text: string,
  requestedPeriod: MealPlanPeriod
): StructuredMealPlanParseResult {
  let candidate: unknown;
  try {
    candidate = JSON.parse(text);
  } catch {
    return { success: false, reason: 'invalid_json' };
  }

  return parseStructuredMealPlanCandidate(candidate, requestedPeriod);
}

export function parseStructuredMealPlanValue(
  value: unknown,
  requestedPeriod: MealPlanPeriod
): StructuredMealPlanParseResult {
  if (!isRecord(value)) {
    return { success: false, reason: 'schema_invalid' };
  }

  const valueRecord = value;
  if (!isUnknownArray(valueRecord.days)) {
    return { success: false, reason: 'schema_invalid' };
  }

  let schedule: StructuredMealPlanSchedule | undefined;
  if (valueRecord.schedule !== undefined && valueRecord.schedule !== null) {
    const parsedSchedule = parseStructuredMealPlanSchedule(valueRecord.schedule);
    if (!parsedSchedule) return { success: false, reason: 'schema_invalid' };
    schedule = parsedSchedule;
  }

  const candidate = {
    ...valueRecord,
    days: valueRecord.days.map(withoutPersistedDayLabel),
  };
  delete (candidate as Record<string, unknown>).schedule;
  const snapshot = valueRecord.availableTimeMinutesSnapshot;
  if (
    snapshot !== undefined &&
    snapshot !== null &&
    (typeof snapshot !== 'number' || !Number.isInteger(snapshot) || snapshot < 0)
  ) {
    return { success: false, reason: 'schema_invalid' };
  }
  delete (candidate as Record<string, unknown>).availableTimeMinutesSnapshot;

  const parsedPlan = parseStructuredMealPlanCandidate(candidate, requestedPeriod, true);
  if (!parsedPlan.success) return parsedPlan;

  for (let index = 0; index < valueRecord.days.length; index += 1) {
    const day = valueRecord.days[index];
    if (!isRecord(day)) continue;
    if ('label' in day && day.label !== parsedPlan.plan.days[index].label) {
      return { success: false, reason: 'schema_invalid' };
    }
  }

  if (parsedPlan.success && snapshot !== undefined) {
    parsedPlan.plan.availableTimeMinutesSnapshot = snapshot as number | null;
  }
  if (parsedPlan.success && schedule !== undefined) {
    parsedPlan.plan.schedule = schedule;
  }
  return parsedPlan;
}

export function renderStructuredMealPlan(plan: StructuredMealPlan): string {
  return plan.days
    .map((day) => {
      const meals = day.meals.map((meal) => {
        const ingredients = meal.ingredients
          .map((ingredient) => {
            const amount =
              ingredient.quantity === null
                ? ''
                : `${ingredient.quantity}${ingredient.unit ? ` ${ingredient.unit}` : ''} `;
            return `${amount}${ingredient.name}`.trim();
          })
          .join(', ');
        const description = meal.description ? ` — ${meal.description}` : '';
        const prepTime =
          meal.prepMinutes === null || meal.prepMinutes === undefined
            ? 'tiempo no estimado'
            : `${meal.prepMinutes} min estimados`;
        return `${meal.title} (${prepTime})${description}${ingredients ? ` (${ingredients})` : ''}`;
      });
      return `${day.label}\nDesayuno: ${meals[0]}\nAlmuerzo: ${meals[1]}\nCena: ${meals[2]}`;
    })
    .join('\n\n');
}
