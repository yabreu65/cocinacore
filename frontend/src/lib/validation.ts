import { z } from 'zod';
import { readExactRecipeAmount, recipeAmountForImport } from '@/lib/recipes/recipe-amount';

// ---------------------------------------------------------------------------
// Zod schemas for all AI API routes
// ---------------------------------------------------------------------------

/** Schema for POST /api/recipe-generate */
export const RecipeGenerateSchema = z.object({
  ingredients: z.array(z.string().min(1).max(200)).max(30).optional().default([]),
  chunks: z.array(z.string().max(2000)).max(20).optional().default([]),
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
  mode: z
    .enum(['inventory_to_menu', 'menu_to_shopping', 'balanced_ai'])
    .optional()
    .default('inventory_to_menu'),
  period: z.enum(['week', 'fortnight', 'month']).optional().default('week'),
  baseCuisine: z.string().max(100).optional(),
  fusionCuisines: z.array(z.string().max(100)).max(2).optional(),
  fusionIntensity: z.enum(['sutil', 'media', 'alta']).optional(),
  /** Explicit one-off generation intent; persisted profile preferences remain server-owned. */
  restrictions: z.array(z.string().max(100)).max(20).optional().default([]),
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

/**
 * Strict public request contract for POST /api/meal-plan.
 *
 * The legacy identity and available-time fields remain explicitly accepted so
 * older clients receive the same safe behavior: those values are ignored and
 * server-owned session/profile state wins. Unknown fields are rejected.
 */
export const MealPlanRequestSchema = MealPlanSchema.extend({
  cuisine: z.string().trim().max(100).optional(),
  country: z.string().trim().max(100).optional(),
  availableTimeMinutes: z.number().int().min(5).max(240).optional(),
  userId: z.string().max(200).optional(),
  tenantId: z.string().max(200).optional(),
}).strict();

export type MealPlanRequestBody = z.infer<typeof MealPlanRequestSchema>;

/** Schema for POST /api/embeddings */
export const EmbeddingsSchema = z
  .object({
    texts: z.array(z.string().min(1).max(5000)).min(1).max(120),
  })
  .superRefine((value, context) => {
    const totalCharacters = value.texts.reduce((total, text) => total + text.length, 0);
    if (totalCharacters > 100_000) {
      context.addIssue({
        code: z.ZodIssueCode.too_big,
        origin: 'string',
        maximum: 100_000,
        type: 'string',
        inclusive: true,
        message: 'El volumen total de texto excede el límite permitido.',
        path: ['texts'],
      });
    }
  });

export type EmbeddingsBody = z.infer<typeof EmbeddingsSchema>;

/** Schema for POST /api/meal-plan/inventory-suggestion */
export const InventorySuggestionSchema = z.object({
  menuContent: z.string().min(1).max(10000),
  peopleCount: z.number().int().min(1).max(100).optional(),
});

export type InventorySuggestionBody = z.infer<typeof InventorySuggestionSchema>;

/** Schema for POST /api/meal-plan/warmup */
export const StructuredWarmupIngredientSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    normalized_name: z.string().trim().min(1).max(200),
    quantity: z.number().finite().nonnegative().nullable(),
    exact_quantity_text: z.string().max(100).optional(),
    unit: z.string().trim().max(50).nullable(),
    optional_quantity_text: z.string().trim().max(100).nullable(),
    category: z.string().trim().max(100).nullable(),
    estimated_cost_optional: z.number().finite().nullable(),
    structured: z.boolean(),
  })
  .strict()
  .refine((item) => item.exact_quantity_text !== undefined
    ? readExactRecipeAmount(item.exact_quantity_text, item.quantity, item.optional_quantity_text) !== null
    : item.optional_quantity_text === null ||
      (item.quantity === null && recipeAmountForImport(null, undefined, item.optional_quantity_text, item.name) !== null));

const WarmupMealCardSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    time: z.string().trim().min(1).max(100),
    difficulty: z.enum(['Fácil', 'Media', 'Alta']),
    badge: z.string().max(100),
    fusionTag: z.string().max(100),
    missing: z.number().int().min(0).max(100),
    aiScore: z.number().finite().min(0).max(100),
    structured_ingredients: z.array(StructuredWarmupIngredientSchema).max(100).optional(),
    recipe_content: z.string().max(20_000).nullable().optional(),
    recipe_review_required: z.literal(true).optional(),
    rag_context: z.array(z.string().max(2_000)).max(20).optional(),
  })
  .strict();

const WarmupPlannerDaySchema = z
  .object({
    day: z.string().trim().min(1).max(50),
    meals: z
      .object({
        Desayuno: WarmupMealCardSchema,
        Almuerzo: WarmupMealCardSchema,
        Cena: WarmupMealCardSchema,
      })
      .strict(),
  })
  .strict();

export const MealPlanWarmupSchema = z
  .object({
    calendar: z
      .array(WarmupPlannerDaySchema)
      .min(1, 'calendar is required and must be non-empty')
      .max(7, 'calendar cannot contain more than 7 days'),
    targetDays: z
      .array(z.string().trim().min(1).max(50))
      .min(1, 'targetDays is required and must be non-empty')
      .max(7, 'targetDays cannot contain more than 7 days')
      .refine((days) => new Set(days).size === days.length, 'targetDays must be unique'),
    inventory: z.array(z.string().trim().min(1).max(200)).max(120),
    baseCuisine: z.string().trim().min(1).max(100),
    fusionCuisines: z.array(z.string().trim().min(1).max(100)).max(2),
    peopleCount: z.number().int().min(1).max(100),
    culinaryProfile: z
      .object({
        level: z.string().trim().max(50).nullable().optional(),
        preferred: z.array(z.string().trim().max(100)).max(10).optional(),
        avoid: z.array(z.string().trim().max(100)).max(10).optional(),
        goals: z.array(z.string().trim().max(100)).max(10).optional(),
      })
      .strict(),
  })
  .strict();

export type MealPlanWarmupBody = z.infer<typeof MealPlanWarmupSchema>;

/** Schema for POST /api/shopping-list. */
export const ShoppingListCreateSchema = z.object({
  ingredientName: z.string().trim().min(1).max(200),
  quantity: z.string().trim().max(100).nullable().optional(),
  source: z.string().trim().max(50).optional().default('manual'),
});

export type ShoppingListCreateBody = z.infer<typeof ShoppingListCreateSchema>;

/** Schema for PATCH /api/shopping-list/:id. */
export const ShoppingListStatusUpdateSchema = z.object({
  status: z.enum(['pending', 'purchased']),
});

export type ShoppingListStatusUpdateBody = z.infer<typeof ShoppingListStatusUpdateSchema>;

export const ShoppingListIdSchema = z.string().uuid();
export const PersistentRecipeIdSchema = z.string().uuid();
export const PersistentRecipeRestoreSchema = z.object({ versionId: z.string().uuid() }).strict();
export type PersistentRecipeRestoreBody = z.infer<typeof PersistentRecipeRestoreSchema>;

const ManualRecipeIngredientSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    quantity: z.string().trim().max(100).nullable().optional(),
    unit: z.string().trim().max(50).nullable().optional(),
  })
  .strict();

const PersistentRecipeContentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  instructions: z.string().trim().min(1).max(20_000),
  servings: z.number().int().min(1).max(100).nullable().optional(),
  ingredients: z.array(ManualRecipeIngredientSchema).max(100),
  category: z.string().trim().max(100).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).optional().default([]),
  sourceRecipeHistoryId: z.string().uuid().nullable().optional(),
});

/** Schema for creating a persistent user recipe. Ownership is always server-derived. */
export const CreatePersistentRecipeSchema = PersistentRecipeContentSchema.strict();
export type CreatePersistentRecipeBody = z.infer<typeof CreatePersistentRecipeSchema>;

/** Schema for appending an edited persistent-recipe version. */
export const EditPersistentRecipeSchema = PersistentRecipeContentSchema.strict();
export type EditPersistentRecipeBody = z.infer<typeof EditPersistentRecipeSchema>;

export const PersistentRecipeArchiveSchema = z.object({ archived: z.boolean() }).strict();
export type PersistentRecipeArchiveBody = z.infer<typeof PersistentRecipeArchiveSchema>;

export const PersistentRecipeListQuerySchema = z
  .object({
    search: z.string().trim().max(200).optional(),
    archived: z.enum(['active', 'archived', 'all']).optional().default('active'),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
    offset: z.coerce.number().int().min(0).max(10_000).optional().default(0),
  })
  .strict();
export type PersistentRecipeListQuery = z.infer<typeof PersistentRecipeListQuerySchema>;

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
