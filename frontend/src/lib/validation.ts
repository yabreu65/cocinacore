import { z } from 'zod';

// ---------------------------------------------------------------------------
// Zod schemas for all AI API routes
// ---------------------------------------------------------------------------

/** Schema for POST /api/recipe-generate */
export const RecipeGenerateSchema = z.object({
  ingredients: z.array(z.string().min(1).max(100)).max(30).optional().default([]),
  chunks: z.array(z.string().max(2000)).max(14).optional().default([]),
  mode: z.enum(['free', 'rag']).optional().default('free'),
  provider: z.enum(['auto', 'gemini']).optional().default('auto'),
  recipeName: z.string().max(200).optional(),
  mealType: z.string().max(100).optional(),
  day: z.string().max(100).optional(),
  peopleCount: z.number().int().min(1).max(100).optional().default(4),
  culinaryProfile: z
    .object({
      level: z.string().max(50).nullable().optional(),
      preferred: z.array(z.string().max(100)).max(10).optional(),
      avoid: z.array(z.string().max(100)).max(10).optional(),
      goals: z.array(z.string().max(100)).max(10).optional(),
      identity: z.array(z.string().max(100)).max(6).optional(),
    })
    .optional(),
});

export type RecipeGenerateBody = z.infer<typeof RecipeGenerateSchema>;

/** Schema for POST /api/meal-plan */
export const MealPlanSchema = z.object({
  mode: z.enum(['inventory_to_menu', 'menu_to_shopping']).optional().default('inventory_to_menu'),
  period: z.enum(['week', 'fortnight', 'month']).optional().default('week'),
  baseCuisine: z.string().max(100).optional(),
  fusionCuisines: z.array(z.string().max(100)).max(2).optional(),
  fusionIntensity: z.enum(['sutil', 'media', 'alta']).optional(),
  inventory: z.array(z.string().max(200)).max(120).optional(),
  peopleCount: z.number().int().min(1).max(100).optional().default(4),
  chunks: z.array(z.string().max(2000)).max(10).optional(),
  culinaryProfile: z
    .object({
      preferred: z.array(z.string().max(100)).max(12).optional(),
      avoid: z.array(z.string().max(100)).max(12).optional(),
      goals: z.array(z.string().max(100)).max(12).optional(),
      level: z.string().max(50).nullable().optional(),
    })
    .optional(),
});

export type MealPlanBody = z.infer<typeof MealPlanSchema>;

/** Schema for POST /api/embeddings */
export const EmbeddingsSchema = z.object({
  texts: z.array(z.string().min(1).max(5000)).min(1).max(120),
});

export type EmbeddingsBody = z.infer<typeof EmbeddingsSchema>;

/** Schema for POST /api/meal-plan/inventory-suggestion */
export const InventorySuggestionSchema = z.object({
  menuContent: z.string().min(1).max(10000),
  peopleCount: z.number().int().min(1).max(100).optional(),
});

export type InventorySuggestionBody = z.infer<typeof InventorySuggestionSchema>;

/** Schema for POST /api/meal-plan/warmup */
export const MealPlanWarmupSchema = z.object({
  calendar: z.array(z.unknown()).min(1, 'calendar is required and must be non-empty'),
  targetDays: z.array(z.unknown()).min(1, 'targetDays is required and must be non-empty'),
});

export type MealPlanWarmupBody = z.infer<typeof MealPlanWarmupSchema>;

// ---------------------------------------------------------------------------
// Validation helper
// ---------------------------------------------------------------------------

export interface ValidationSuccess<T> {
  success: true;
  data: T;
}

export interface ValidationError {
  success: false;
  error: {
    status: 400;
    body: {
      error: string;
      details: Array<{ path: string; message: string }>;
    };
  };
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationError;

/**
 * Parses and validates a request body against a Zod schema.
 *
 * Returns a discriminated result so callers can narrow by `success`.
 *
 * @example
 * const result = await validateRequest(request, RecipeGenerateSchema);
 * if (!result.success) {
 *   return NextResponse.json(result.error.body, { status: result.error.status });
 * }
 * // result.data is RecipeGenerateBody
 */
export async function validateRequest<T>(
  request: Request,
  schema: z.ZodSchema<T>
): Promise<ValidationResult<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      success: false,
      error: {
        status: 400,
        body: {
          error: 'Validation failed',
          details: [{ path: 'body', message: 'Request body must be valid JSON' }],
        },
      },
    };
  }

  const parsed = schema.safeParse(raw);

  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => ({
      path: issue.path.length > 0 ? issue.path.join('.') : 'body',
      message: issue.message,
    }));

    return {
      success: false,
      error: {
        status: 400,
        body: {
          error: 'Validation failed',
          details,
        },
      },
    };
  }

  return { success: true, data: parsed.data };
}
