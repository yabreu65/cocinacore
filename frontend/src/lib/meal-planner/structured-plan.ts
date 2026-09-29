import { z } from 'zod';
import {
  getMealPlanCanonicalDayLabel,
  getMealPlanDayCount,
  type MealPlanPeriod,
} from './prompt';

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
  description: string | null;
  ingredients: StructuredMealPlanIngredient[];
}

export interface StructuredMealPlanDay {
  dayIndex: number;
  label: string;
  meals: StructuredMeal[];
}

export interface StructuredMealPlan {
  period: MealPlanPeriod;
  dayCount: number;
  days: StructuredMealPlanDay[];
}

export type StructuredMealPlanParseResult =
  | { success: true; plan: StructuredMealPlan }
  | { success: false; reason: string };

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function boundedRequiredText(maxLength: number) {
  return z
    .string()
    .transform(normalizeWhitespace)
    .pipe(z.string().min(1).max(maxLength));
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
    description: nullableBoundedText(300),
    ingredients: z.array(structuredMealPlanIngredientCandidateSchema).min(1).max(30),
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
              required: ['mealType', 'title', 'description', 'ingredients'],
              properties: {
                mealType: { type: 'string', enum: [...MEAL_TYPES] },
                title: { type: 'string', minLength: 1, maxLength: 160 },
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

export function buildStructuredMealPlanInstructions(period: MealPlanPeriod): string {
  const dayCount = getMealPlanDayCount(period);

  return `Devuelve únicamente un objeto JSON válido, sin markdown ni texto adicional.
El JSON debe respetar exactamente el esquema de respuesta configurado.
Usa period como "${period}", dayCount ${dayCount}, y días con dayIndex consecutivos de 1 a ${dayCount}.
Cada día debe incluir exactamente un mealType breakfast, lunch y dinner.
Para cantidades desconocidas usa quantity: null y unit: null; no inventes cantidades.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
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
  requestedPeriod: MealPlanPeriod
): StructuredMealPlanParseResult {
  const parsed = structuredMealPlanCandidateSchema.safeParse(candidate);
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
    if (mealsByType.size !== MEAL_TYPES.length || MEAL_TYPES.some((type) => !mealsByType.has(type))) {
      return { success: false, reason: 'meal_types_invalid' };
    }

    days.push({
      dayIndex: day.dayIndex,
      label: getMealPlanCanonicalDayLabel(requestedPeriod, day.dayIndex),
      meals: MEAL_TYPES.map((mealType) => mealsByType.get(mealType)!),
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

  const candidate = {
    ...valueRecord,
    days: valueRecord.days.map(withoutPersistedDayLabel),
  };

  const parsedPlan = parseStructuredMealPlanCandidate(candidate, requestedPeriod);
  if (!parsedPlan.success) return parsedPlan;

  for (let index = 0; index < valueRecord.days.length; index += 1) {
    const day = valueRecord.days[index];
    if (!isRecord(day)) continue;
    if ('label' in day && day.label !== parsedPlan.plan.days[index].label) {
      return { success: false, reason: 'schema_invalid' };
    }
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
        return `${meal.title}${description}${ingredients ? ` (${ingredients})` : ''}`;
      });
      return `${day.label}\nDesayuno: ${meals[0]}\nAlmuerzo: ${meals[1]}\nCena: ${meals[2]}`;
    })
    .join('\n\n');
}
